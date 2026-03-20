/**
 * Solver Registry + RFQ Engine + Scoring
 *
 * Flow:
 *   Solver startup → WS /api/v1/solver/ws → {type:"register"} → stored in registry
 *   Every 30s     → WS {type:"heartbeat"} → mark online + update balances
 *   OrderCreated  → broadcastRFQ()        → WS {type:"rfq"} to each solver (3s timeout)
 *   Quotes in     → scoreQuotes()         → pick winner
 *   Winner notified → WS {type:"execute"} → solver calls executeIntent()
 *   Progress      → WS messages back      → SSE to frontend
 *
 * Fade detection:
 *   Every 60s: check OPEN orders past exclusivityDeadline → apply fadePenalty
 *   3 fades → suspended 24h
 */

import { logger } from '@lib/logger'
import type { IntentOrder } from '@services/intent.service'
import { getIntent } from '@services/intent-orderbook.service'
import { EventEmitter } from 'events'
import type { WebSocket } from 'ws'

// ── Gasless execute config (env vars) ────────────────────────────────────────
const EXECUTE_CONTRACT_ADDRESS = process.env.BASE_SEPOLIA_INTENT_CONTRACT ?? ''
const EXECUTE_CHAIN_ID         = Number(process.env.BASE_SEPOLIA_CHAIN_ID ?? 84532)
const EXECUTE_RPC_URL          = process.env.BASE_SEPOLIA_RPC ?? 'https://sepolia.base.org'

// ============================================================================
// Shared event bus for real-time progress streaming
// ============================================================================

export const solverEvents = new EventEmitter()

export interface SolverProgressEvent {
  type: 'rfq_broadcast' | 'rfq_winner' | 'execute_sent' | 'order_fulfilled' | 'sol_sent' | 'vaa_ready' | 'settled'
  orderId: string
  data: Record<string, unknown>
}

// ============================================================================
// Types
// ============================================================================

export interface SolverInfo {
  id:               string
  name:             string
  evmAddress:       string
  solanaAddress:    string
  ws:               WebSocket | null   // active WebSocket connection (null if offline)
  supportedRoutes:  string[]           // e.g. ["evm-base→solana"]
  token:            string             // opaque token issued on register
  online:           boolean
  lastHeartbeat:    number             // unix ms
  suspended:        boolean
  suspendUntil:     number | null      // unix ms
  fadePenalty:      number             // count of unfilled exclusive windows
  totalFills:       number
  totalRFQAccepted: number             // how many exclusive windows received
  reliabilityScore: number             // 0-100, pct exclusive windows filled
  avgFillTime:      number             // seconds, rolling avg
  tier:             0 | 1 | 2 | 3     // 0=new 1=starter 2=established 3=veteran
  solanaBalance:    string
  evmBalance:       string
  registeredAt:     number             // unix ms
}

export interface Quote {
  solverId:     string
  solverName:   string
  quotedPrice:  string   // lamports
  estimatedETA: number   // seconds
  expiresAt:    number   // unix ms
  score:        number
  winner:       boolean
}

export interface RFQResult {
  orderId:              string
  rfqSentAt:            number    // unix ms
  quotes:               Quote[]
  winner:               string | null   // solver name
  winnerId:             string | null   // solver id
  winnerAddress:        string | null   // solver's EVM address (for on-chain exclusive)
  reasoning:            string
  exclusivityDeadline:  number | null   // unix ms (30s after RFQ result)
}

// ============================================================================
// In-memory stores
// ============================================================================

const registry   = new Map<string, SolverInfo>()   // id → SolverInfo
const byToken    = new Map<string, string>()        // token → id
const rfqResults = new Map<string, RFQResult>()     // orderId → RFQResult

// Track pending exclusive windows: orderId → { winnerId, deadline }
const pendingExclusive = new Map<string, { winnerId: string; deadline: number }>()

// WebSocket connection → solverId mapping (for fast lookup on incoming messages)
const solverWsToId = new Map<WebSocket, string>()

// ============================================================================
// RFQ collector — collects quotes from all eligible solvers within timeout
// ============================================================================

interface RawQuote {
  solverId:     string
  solverName:   string
  quotedPrice:  string
  estimatedETA: number
  expiresAt:    number
}

interface RFQCollector {
  quotes:        RawQuote[]
  expectedCount: number
  resolved:      boolean
  timeout:       ReturnType<typeof setTimeout>
  resolve:       (q: RawQuote[]) => void
}

const rfqCollectors = new Map<string, RFQCollector>()

// ============================================================================
// Tier computation
// ============================================================================

function computeTier(solver: SolverInfo): 0 | 1 | 2 | 3 {
  if (solver.totalFills >= 50 && solver.reliabilityScore >= 80) return 3
  if (solver.totalFills >= 10 && solver.reliabilityScore >= 60) return 2
  if (solver.totalFills >= 1)  return 1
  return 0
}

// ============================================================================
// Register
// ============================================================================

export interface RegisterBody {
  name:            string
  evmAddress:      string
  solanaAddress:   string
  callbackUrl?:    string   // legacy field — ignored in WS mode
  supportedRoutes: string[]
}

export function registerSolver(body: RegisterBody): { solverId: string; token: string } {
  // Upsert by evmAddress — prevents duplicate registrations
  const existing = Array.from(registry.values()).find(
    s => s.evmAddress.toLowerCase() === body.evmAddress.toLowerCase()
  )

  if (existing) {
    // Re-register: reset online state, keep stats
    existing.name            = body.name
    existing.solanaAddress   = body.solanaAddress
    existing.supportedRoutes = body.supportedRoutes
    existing.online          = true
    existing.lastHeartbeat   = Date.now()
    existing.suspended       = false
    existing.suspendUntil    = null

    logger.info({ name: body.name, id: existing.id }, '[Solver] Re-registered')
    return { solverId: existing.id, token: existing.token }
  }

  const id    = crypto.randomUUID()
  const token = crypto.randomUUID()

  const solver: SolverInfo = {
    id,
    name:             body.name,
    evmAddress:       body.evmAddress,
    solanaAddress:    body.solanaAddress,
    ws:               null,
    supportedRoutes:  body.supportedRoutes,
    token,
    online:           true,
    lastHeartbeat:    Date.now(),
    suspended:        false,
    suspendUntil:     null,
    fadePenalty:      0,
    totalFills:       0,
    totalRFQAccepted: 0,
    reliabilityScore: 100,  // start optimistic, decays on fades
    avgFillTime:      0,
    tier:             0,
    solanaBalance:    '0',
    evmBalance:       '0',
    registeredAt:     Date.now(),
  }

  registry.set(id, solver)
  byToken.set(token, id)

  logger.info({ name: body.name, id, routes: body.supportedRoutes }, '[Solver] Registered')
  return { solverId: id, token }
}

// ============================================================================
// Heartbeat
// ============================================================================

export interface HeartbeatBody {
  solanaBalance: string
  evmBalance:    string
  status:        'ready' | 'busy' | 'draining'
}

export function processHeartbeat(token: string, body: HeartbeatBody): boolean {
  const id     = byToken.get(token)
  if (!id) return false
  const solver = registry.get(id)
  if (!solver) return false

  solver.lastHeartbeat  = Date.now()
  solver.online         = body.status !== 'draining'
  solver.solanaBalance  = body.solanaBalance
  solver.evmBalance     = body.evmBalance

  // Lift suspension if past suspendUntil
  if (solver.suspended && solver.suspendUntil && Date.now() >= solver.suspendUntil) {
    solver.suspended    = false
    solver.suspendUntil = null
    logger.info({ name: solver.name }, '[Solver] Suspension lifted')
  }

  return true
}

// ============================================================================
// List
// ============================================================================

export function listSolvers(): Omit<SolverInfo, 'token' | 'ws'>[] {
  return Array.from(registry.values()).map(({ token: _t, ws: _ws, ...rest }) => rest)
}

export function getSolverById(id: string): SolverInfo | undefined {
  return registry.get(id)
}

// ============================================================================
// Token verification helper
// ============================================================================

export function verifySolverToken(token: string): SolverInfo | null {
  const id = byToken.get(token)
  if (!id) return null
  return registry.get(id) ?? null
}

// ============================================================================
// Scoring
// ============================================================================

function scoreQuotes(quotes: Array<{ solverId: string; quotedPrice: string; estimatedETA: number; expiresAt: number; solverName: string }>): Quote[] {
  if (quotes.length === 0) return []

  const prices     = quotes.map(q => parseFloat(q.quotedPrice))
  const etas       = quotes.map(q => q.estimatedETA)
  const bestPrice  = Math.max(...prices)
  const fastestETA = Math.min(...etas)

  return quotes.map(q => {
    const solver = Array.from(registry.values()).find(s => s.id === q.solverId)
    const price  = parseFloat(q.quotedPrice)
    const eta    = q.estimatedETA

    // Price score: higher payout → better for user
    const priceScore = bestPrice > 0 ? (price / bestPrice) * 50 : 50
    // Reliability score
    const relScore   = solver ? (solver.reliabilityScore / 100) * 25 : 0
    // Speed score
    const speedScore = eta > 0 && fastestETA > 0 ? (fastestETA / eta) * 15 : 15
    // Liquidity: rough check via balance strings
    const hasLiquidity = solver && parseFloat(solver.solanaBalance) > 0 ? 10 : 0

    return {
      solverId:     q.solverId,
      solverName:   q.solverName,
      quotedPrice:  q.quotedPrice,
      estimatedETA: q.estimatedETA,
      expiresAt:    q.expiresAt,
      score:        Math.round((priceScore + relScore + speedScore + hasLiquidity) * 10) / 10,
      winner:       false,
    }
  }).sort((a, b) => b.score - a.score)
}

// ============================================================================
// WebSocket handlers (called from index.ts WS server)
// ============================================================================

/**
 * Called when a new solver WebSocket connection is established.
 * The solver must send a {type:"register"} message within the session.
 */
export function onSolverConnected(ws: WebSocket): void {
  logger.info('[Solver WS] New connection — awaiting register message')
}

/**
 * Called when a solver WebSocket connection closes or errors.
 * Marks the solver offline and removes the WS mapping.
 */
export function onSolverDisconnected(ws: WebSocket): void {
  const solverId = solverWsToId.get(ws)
  if (solverId) {
    const solver = registry.get(solverId)
    if (solver) {
      solver.ws     = null
      solver.online = false
      logger.info({ name: solver.name }, '[Solver WS] Disconnected — marked offline')
    }
    solverWsToId.delete(ws)
  } else {
    logger.info('[Solver WS] Unregistered connection closed')
  }
}

/**
 * Called for every text message received from a solver WebSocket.
 * Dispatches to the appropriate handler based on message type.
 */
export function onSolverMessage(ws: WebSocket, data: string): void {
  let msg: Record<string, unknown>
  try {
    msg = JSON.parse(data) as Record<string, unknown>
  } catch {
    logger.warn('[Solver WS] Non-JSON message received — ignoring')
    return
  }

  const type = msg['type'] as string | undefined

  // ── Register ─────────────────────────────────────────────────────────────
  if (type === 'register') {
    const result = registerSolverWs(ws, msg)
    if (result) {
      const { solverId, token } = result
      wsSend(ws, { type: 'registered', solverId, token })
      logger.info({ solverId }, '[Solver WS] Register ACK sent')
    } else {
      wsSend(ws, { type: 'error', error: 'Registration failed — check name/evmAddress/solanaAddress' })
    }
    return
  }

  // All other message types require prior registration
  const solverId = solverWsToId.get(ws)
  if (!solverId) {
    wsSend(ws, { type: 'error', error: 'Not registered — send {type:"register"} first' })
    return
  }

  // ── RFQ quote ─────────────────────────────────────────────────────────────
  if (type === 'rfq_quote') {
    const orderId      = msg['orderId']      as string | undefined
    const quotedPrice  = msg['quotedPrice']  as string | undefined
    const estimatedETA = msg['estimatedETA'] as number | undefined
    const expiresAt    = msg['expiresAt']    as number | undefined

    if (!orderId || !quotedPrice || estimatedETA == null || expiresAt == null) {
      logger.warn({ solverId }, '[Solver WS] Malformed rfq_quote — ignoring')
      return
    }

    const solver    = registry.get(solverId)
    const collector = rfqCollectors.get(orderId)
    if (!collector) {
      logger.warn({ solverId, orderId }, '[Solver WS] rfq_quote for unknown/expired orderId — ignoring')
      return
    }
    if (collector.resolved) return

    collector.quotes.push({
      solverId,
      solverName:   solver?.name ?? solverId,
      quotedPrice,
      estimatedETA,
      expiresAt,
    })

    logger.debug({ orderId, solverId, quotedPrice }, '[Solver WS] Quote received')

    // Resolve early if all expected quotes have arrived
    if (collector.quotes.length >= collector.expectedCount) {
      collector.resolved = true
      clearTimeout(collector.timeout)
      collector.resolve(collector.quotes)
    }
    return
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────────
  if (type === 'heartbeat') {
    const solver = registry.get(solverId)
    if (!solver) return

    solver.lastHeartbeat = Date.now()
    solver.online        = msg['status'] !== 'draining'
    if (msg['solanaBalance'] != null) solver.solanaBalance = String(msg['solanaBalance'])
    if (msg['evmBalance']    != null) solver.evmBalance    = String(msg['evmBalance'])

    // Lift suspension if past suspendUntil
    if (solver.suspended && solver.suspendUntil && Date.now() >= solver.suspendUntil) {
      solver.suspended    = false
      solver.suspendUntil = null
      logger.info({ name: solver.name }, '[Solver] Suspension lifted')
    }

    logger.debug({ name: solver.name }, '[Solver WS] Heartbeat OK')
    return
  }

  // ── execute_confirmed (EVM tx mined) ──────────────────────────────────────
  if (type === 'execute_confirmed') {
    const orderId = msg['orderId'] as string | undefined
    const txHash  = msg['txHash']  as string | undefined
    if (!orderId) return
    emitProgressStep(solverId, { orderId, sseType: 'execute_sent', txHash })
    // Clear exclusive window so checkFades() does not penalise an actively executing solver
    clearPendingExclusive(orderId)
    return
  }

  // ── sol_sent ──────────────────────────────────────────────────────────────
  if (type === 'sol_sent') {
    const orderId = msg['orderId'] as string | undefined
    const txHash  = msg['txHash']  as string | undefined
    if (!orderId) return
    emitProgressStep(solverId, { orderId, sseType: 'sol_sent', txHash })
    return
  }

  // ── vaa_ready ─────────────────────────────────────────────────────────────
  if (type === 'vaa_ready') {
    const orderId = msg['orderId'] as string | undefined
    if (!orderId) return
    emitProgressStep(solverId, { orderId, sseType: 'vaa_ready' })
    return
  }

  // ── settled (EVM settle tx mined) ─────────────────────────────────────────
  if (type === 'settled') {
    const orderId = msg['orderId'] as string | undefined
    const txHash  = msg['txHash']  as string | undefined
    if (!orderId) return
    emitProgressStep(solverId, { orderId, sseType: 'settled', txHash })
    return
  }

  logger.warn({ type, solverId }, '[Solver WS] Unknown message type — ignoring')
}

// ============================================================================
// Internal: register a solver over WebSocket
// ============================================================================

function registerSolverWs(
  ws: WebSocket,
  msg: Record<string, unknown>
): { solverId: string; token: string } | null {
  const name           = msg['name']           as string | undefined
  const evmAddress     = msg['evmAddress']     as string | undefined
  const solanaAddress  = msg['solanaAddress']  as string | undefined
  const supportedRoutes = (msg['supportedRoutes'] as string[] | undefined) ?? []

  if (!name || !evmAddress || !solanaAddress) return null

  const result = registerSolver({ name, evmAddress, solanaAddress, supportedRoutes })
  const solver = registry.get(result.solverId)
  if (!solver) return null

  // Attach the WebSocket to the solver entry
  solver.ws     = ws
  solver.online = true
  solverWsToId.set(ws, result.solverId)

  logger.info({ name, solverId: result.solverId }, '[Solver WS] Registered via WebSocket')
  return result
}

// ============================================================================
// Internal: emit a progress step SSE event on behalf of a solver
// ============================================================================

function emitProgressStep(
  solverId: string,
  opts: { orderId: string; sseType: SolverProgressEvent['type']; txHash?: string }
): void {
  const solver = registry.get(solverId)
  const eventData: SolverProgressEvent = {
    type:    opts.sseType,
    orderId: opts.orderId,
    data: {
      solverName: solver?.name ?? solverId,
      ...(opts.txHash ? { txHash: opts.txHash } : {}),
    },
  }
  solverEvents.emit(opts.sseType, eventData)
  logger.info(
    { orderId: opts.orderId, type: opts.sseType, txHash: opts.txHash, solver: solver?.name },
    '[Solver] Progress step emitted'
  )
}

// ============================================================================
// Internal: safe JSON send over WebSocket
// ============================================================================

function wsSend(ws: WebSocket, payload: unknown): void {
  try {
    ws.send(JSON.stringify(payload))
  } catch (err) {
    logger.warn({ err }, '[Solver WS] Failed to send message')
  }
}

// ============================================================================
// RFQ Broadcast
// ============================================================================

const EXCLUSIVITY_WINDOW_MS = 30_000   // 30 second exclusive window for winner
const RFQ_TIMEOUT_MS        = 3_000    // wait max 3s for solver quotes

export async function broadcastRFQ(order: IntentOrder): Promise<RFQResult | null> {
  const route = `${order.chain}→solana`

  // Find eligible solvers — must have an active WS connection
  const eligible = Array.from(registry.values()).filter(s =>
    s.ws !== null &&
    s.online &&
    !s.suspended &&
    s.supportedRoutes.includes(route) &&
    Date.now() - s.lastHeartbeat < 60_000  // last heartbeat within 60s
  )

  if (eligible.length === 0) {
    logger.warn({ orderId: order.orderId, route }, '[RFQ] No eligible solvers')
    return null
  }

  const rfqSentAt = Date.now()

  logger.info(
    { orderId: order.orderId, solverCount: eligible.length },
    '[RFQ] Broadcasting to solvers via WS'
  )

  // Emit real-time event for SSE streaming
  solverEvents.emit('rfq_broadcast', {
    type: 'rfq_broadcast',
    orderId: order.orderId,
    data: {
      solverCount: eligible.length,
      solverNames: eligible.map(s => s.name),
    },
  })

  const rfqMessage = {
    type:       'rfq',
    orderId:    order.orderId,
    startPrice: order.startPrice,
    floorPrice: order.floorPrice,
    deadline:   order.deadline,
    amount:     order.amount,
  }

  // Create collector before sending to avoid race conditions
  const rawQuotes = await new Promise<RawQuote[]>((resolve) => {
    const timeoutHandle = setTimeout(() => {
      const collector = rfqCollectors.get(order.orderId)
      if (collector && !collector.resolved) {
        collector.resolved = true
        logger.info(
          { orderId: order.orderId, received: collector.quotes.length, expected: eligible.length },
          '[RFQ] Timeout — resolving with partial quotes'
        )
        resolve(collector.quotes)
      }
    }, RFQ_TIMEOUT_MS)

    rfqCollectors.set(order.orderId, {
      quotes:        [],
      expectedCount: eligible.length,
      resolved:      false,
      timeout:       timeoutHandle,
      resolve,
    })

    // Send rfq message to each eligible solver
    for (const solver of eligible) {
      if (solver.ws) {
        wsSend(solver.ws, rfqMessage)
      }
    }
  })

  // Clean up collector
  rfqCollectors.delete(order.orderId)

  const scoredQuotes = scoreQuotes(rawQuotes)

  let winner:        string | null = null
  let winnerId:      string | null = null
  let winnerAddress: string | null = null
  let reasoning      = 'No quotes received'
  let exclusivityDeadline: number | null = null

  if (scoredQuotes.length > 0) {
    // Apply tier-based new-solver slot (20% chance for newbies if veterans present)
    const veterans = scoredQuotes.filter(q => {
      const s = registry.get(q.solverId)
      return s && s.totalFills >= 10
    })
    const newbies = scoredQuotes.filter(q => {
      const s = registry.get(q.solverId)
      return s && s.totalFills < 10
    })

    let winnerQuote: Quote
    if (newbies.length > 0 && veterans.length > 0 && Math.random() < 0.20) {
      winnerQuote = newbies[0]   // best newbie score
      reasoning = `New solver opportunity: ${winnerQuote.solverName} selected (20% slot)`
    } else {
      winnerQuote = scoredQuotes[0]
      const reason = scoredQuotes.length > 1
        ? `Best overall score: ${winnerQuote.score.toFixed(1)} vs ${scoredQuotes[1].score.toFixed(1)}`
        : 'Only quote received'
      reasoning = `${reason} — ${winnerQuote.solverName} wins`
    }

    winnerQuote.winner   = true
    winner               = winnerQuote.solverName
    winnerId             = winnerQuote.solverId
    exclusivityDeadline  = Date.now() + EXCLUSIVITY_WINDOW_MS

    const winnerSolver = registry.get(winnerQuote.solverId)
    if (winnerSolver) {
      winnerAddress = winnerSolver.evmAddress
      winnerSolver.totalRFQAccepted++
    }

    // Track this as a pending exclusive window for fade detection
    pendingExclusive.set(order.orderId, {
      winnerId:  winnerQuote.solverId,
      deadline:  exclusivityDeadline,
    })

    logger.info(
      { orderId: order.orderId, winner, score: winnerQuote.score, quotes: scoredQuotes.length },
      '[RFQ] Winner selected'
    )

    // Emit real-time event for SSE streaming
    solverEvents.emit('rfq_winner', {
      type: 'rfq_winner',
      orderId: order.orderId,
      data: {
        winner,
        winnerId,
        score:               winnerQuote.score,
        reasoning,
        quotedPrice:         winnerQuote.quotedPrice,
        estimatedETA:        winnerQuote.estimatedETA,
        exclusivityDeadline: Date.now() + EXCLUSIVITY_WINDOW_MS,
      },
    })

    // ── Send execute signal to winning solver via WebSocket ───────────────────
    if (winnerSolver?.ws) {
      const pendingIntent = getIntent(order.orderId)
      if (pendingIntent) {
        const executeMessage = {
          type:            'execute',
          intentId:        order.orderId,
          intent:          pendingIntent.intent,
          signature:       pendingIntent.signature,
          contractAddress: EXECUTE_CONTRACT_ADDRESS,
          chainId:         EXECUTE_CHAIN_ID,
          rpcUrl:          EXECUTE_RPC_URL,
        }
        wsSend(winnerSolver.ws, executeMessage)
        logger.info(
          { orderId: order.orderId, winner },
          '[RFQ] Execute message sent to winner via WS — solver will report execute_confirmed when mined'
        )
      }
      // Non-gasless orders: solver detects via EVM event listener — no signal needed
    }
  }

  const result: RFQResult = {
    orderId:             order.orderId,
    rfqSentAt,
    quotes:              scoredQuotes,
    winner,
    winnerId,
    winnerAddress,
    reasoning,
    exclusivityDeadline,
  }

  rfqResults.set(order.orderId, result)
  return result
}

// ============================================================================
// Selection query
// ============================================================================

export function getSolverSelection(orderId: string): RFQResult | null {
  return rfqResults.get(orderId) ?? null
}

// ============================================================================
// Stat updates (called by indexer when OrderFulfilled is observed)
// ============================================================================

export function recordFill(solverEvmAddress: string, fillTimeMs?: number, orderId?: string): void {
  const solver = Array.from(registry.values()).find(
    s => s.evmAddress.toLowerCase() === solverEvmAddress.toLowerCase()
  )
  if (!solver) return

  solver.totalFills++

  if (fillTimeMs != null) {
    const fillTimeSec = fillTimeMs / 1000
    solver.avgFillTime = solver.totalFills === 1
      ? fillTimeSec
      : (solver.avgFillTime * (solver.totalFills - 1) + fillTimeSec) / solver.totalFills
  }

  // Recalculate reliability (simple ratio)
  if (solver.totalRFQAccepted > 0) {
    solver.reliabilityScore = Math.round((solver.totalFills / solver.totalRFQAccepted) * 100)
  }

  solver.tier = computeTier(solver)

  // Emit real-time fulfilled event for SSE streaming
  solverEvents.emit('order_fulfilled', {
    type: 'order_fulfilled',
    orderId: orderId ?? '-',
    data: {
      solverName:    solver.name,
      solverAddress: solver.evmAddress,
      fillTimeMs,
    },
  })

  logger.info(
    { name: solver.name, totalFills: solver.totalFills, reliability: solver.reliabilityScore },
    '[Solver] Fill recorded'
  )
}

// ============================================================================
// Fade detection (called by cron every 60s)
// ============================================================================

export function checkFades(): void {
  const now = Date.now()

  for (const [orderId, pending] of pendingExclusive.entries()) {
    if (now < pending.deadline + 5_000) continue  // give 5s grace after deadline

    const rfq = rfqResults.get(orderId)
    // Skip fade if a winner executed — clearPendingExclusive should have fired,
    // but guard here in case of race conditions or orderId mismatches.
    if (rfq?.winner) {
      pendingExclusive.delete(orderId)
      continue
    }

    // Mark as fade: exclusive window expired with no winner executing
    const solver = registry.get(pending.winnerId)
    if (solver) {
      solver.fadePenalty++
      solver.reliabilityScore = Math.max(0, solver.reliabilityScore - 10)

      if (solver.fadePenalty >= 3) {
        solver.suspended    = true
        solver.suspendUntil = now + 24 * 60 * 60 * 1000
        logger.warn({ name: solver.name }, '[Solver] Suspended: 3 fades')
      } else {
        logger.warn({ name: solver.name, fades: solver.fadePenalty }, '[Solver] Fade penalty applied')
      }
    }

    pendingExclusive.delete(orderId)
  }
}

// Clear pending exclusive when order is fulfilled (prevents false fade)
export function clearPendingExclusive(orderId: string): void {
  pendingExclusive.delete(orderId)
}

// ============================================================================
// Heartbeat timeout checker (offline detection, called every 30s)
// ============================================================================

export function getActiveSolverCount(): number {
  return Array.from(registry.values()).filter(s => s.online && !s.suspended).length
}

export function markStaleOffline(): void {
  const cutoff = Date.now() - 60_000
  for (const solver of registry.values()) {
    if (solver.online && solver.lastHeartbeat < cutoff) {
      solver.online = false
      logger.info({ name: solver.name }, '[Solver] Marked offline: missed heartbeats')
    }
  }
}
