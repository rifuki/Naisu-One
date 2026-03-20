/**
 * Solver Registry + RFQ Engine + Scoring
 *
 * Flow:
 *   Solver startup → POST /solver/register → stored in registry
 *   Every 30s     → POST /solver/heartbeat → mark online + update balances
 *   OrderCreated  → broadcastRFQ()         → POST /rfq to each solver (3s timeout)
 *   Quotes in     → scoreQuotes()          → pick winner
 *   Result stored → GET /solver/selection/:orderId → frontend reads
 *
 * Fade detection:
 *   Every 60s: check OPEN orders past exclusivityDeadline → apply fadePenalty
 *   3 fades → suspended 24h
 */

import { logger } from '@lib/logger'
import type { IntentOrder } from '@services/intent.service'
import { getIntent } from '@services/intent-orderbook.service'
import { EventEmitter } from 'events'

// ── Gasless execute config (env vars) ────────────────────────────────────────
const EXECUTE_CONTRACT_ADDRESS = process.env.BASE_SEPOLIA_INTENT_CONTRACT ?? ''
const EXECUTE_CHAIN_ID         = Number(process.env.BASE_SEPOLIA_CHAIN_ID ?? 84532)
const EXECUTE_RPC_URL          = process.env.BASE_SEPOLIA_RPC ?? 'https://sepolia.base.org'
const EXECUTE_TIMEOUT_MS       = 10_000

// ============================================================================
// Shared event bus for real-time progress streaming
// ============================================================================

export const solverEvents = new EventEmitter()

export interface SolverProgressEvent {
  type: 'rfq_broadcast' | 'rfq_winner' | 'execute_sent' | 'order_fulfilled' | 'sol_sent' | 'vaa_ready'
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
  callbackUrl:      string         // solver's HTTP base URL for RFQ calls
  supportedRoutes:  string[]       // e.g. ["evm-base→solana"]
  token:            string         // opaque token for heartbeat auth
  online:           boolean
  lastHeartbeat:    number         // unix ms
  suspended:        boolean
  suspendUntil:     number | null  // unix ms
  fadePenalty:      number         // count of unfilled exclusive windows
  totalFills:       number
  totalRFQAccepted: number         // how many exclusive windows received
  reliabilityScore: number         // 0-100, pct exclusive windows filled
  avgFillTime:      number         // seconds, rolling avg
  tier:             0 | 1 | 2 | 3  // 0=new 1=starter 2=established 3=veteran
  solanaBalance:    string
  evmBalance:       string
  registeredAt:     number         // unix ms
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
  callbackUrl:     string
  supportedRoutes: string[]
}

export function registerSolver(body: RegisterBody): { solverId: string; token: string } {
  // Prevent duplicate names (upsert by evmAddress instead)
  const existing = Array.from(registry.values()).find(
    s => s.evmAddress.toLowerCase() === body.evmAddress.toLowerCase()
  )

  if (existing) {
    // Re-register: reset online state, keep stats
    existing.name           = body.name
    existing.solanaAddress  = body.solanaAddress
    existing.callbackUrl    = body.callbackUrl
    existing.supportedRoutes = body.supportedRoutes
    existing.online         = true
    existing.lastHeartbeat  = Date.now()
    existing.suspended      = false
    existing.suspendUntil   = null

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
    callbackUrl:      body.callbackUrl,
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
    solver.suspended   = false
    solver.suspendUntil = null
    logger.info({ name: solver.name }, '[Solver] Suspension lifted')
  }

  return true
}

// ============================================================================
// List
// ============================================================================

export function listSolvers(): Omit<SolverInfo, 'token'>[] {
  return Array.from(registry.values()).map(({ token: _t, ...rest }) => rest)
}

export function getSolverById(id: string): SolverInfo | undefined {
  return registry.get(id)
}

// ============================================================================
// Scoring
// ============================================================================

function scoreQuotes(quotes: Array<{ solverId: string; quotedPrice: string; estimatedETA: number; expiresAt: number; solverName: string }>): Quote[] {
  if (quotes.length === 0) return []

  const prices  = quotes.map(q => parseFloat(q.quotedPrice))
  const etas    = quotes.map(q => q.estimatedETA)
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
// RFQ Broadcast
// ============================================================================

const EXCLUSIVITY_WINDOW_MS = 30_000   // 30 second exclusive window for winner
const RFQ_TIMEOUT_MS        = 3_000    // wait max 3s for solver quotes

export async function broadcastRFQ(order: IntentOrder): Promise<RFQResult | null> {
  const route = `${order.chain}→solana`

  // Find eligible solvers
  const eligible = Array.from(registry.values()).filter(s =>
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
    '[RFQ] Broadcasting to solvers'
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

  const rfqPayload = {
    orderId:          order.orderId,
    amount:           order.amount,
    amountRaw:        order.amountRaw,
    startPrice:       order.startPrice,
    floorPrice:       order.floorPrice,
    destinationChain: order.destinationChain,
    deadline:         order.deadline,
  }

  // POST to each solver, collect quotes within 3s
  const quoteResponses = await Promise.allSettled(
    eligible.map(async (solver) => {
      const url = `${solver.callbackUrl}/rfq`
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), RFQ_TIMEOUT_MS)
      try {
        const res = await fetch(url, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(rfqPayload),
          signal:  ctrl.signal,
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = await res.json() as {
          quotedPrice:  string
          estimatedETA: number
          expiresAt:    number
        }
        return {
          solverId:     solver.id,
          solverName:   solver.name,
          quotedPrice:  body.quotedPrice,
          estimatedETA: body.estimatedETA,
          expiresAt:    body.expiresAt,
        }
      } finally {
        clearTimeout(timer)
      }
    })
  )

  const rawQuotes = quoteResponses
    .filter((r): r is PromiseFulfilledResult<{ solverId: string; solverName: string; quotedPrice: string; estimatedETA: number; expiresAt: number }> =>
      r.status === 'fulfilled')
    .map(r => r.value)

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
        score: winnerQuote.score,
        reasoning,
        quotedPrice: winnerQuote.quotedPrice,
        estimatedETA: winnerQuote.estimatedETA,
        exclusivityDeadline: Date.now() + EXCLUSIVITY_WINDOW_MS,
      },
    })

    // ── Gasless execute signal: send intent + signature to winning solver ──────
    // For gasless intents, the solver must call executeIntent() on-chain.
    // The intent + EIP-712 signature are stored in the orderbook — look them up.
    if (winnerSolver) {
      const pendingIntent = getIntent(order.orderId)
      if (pendingIntent) {
        const executeUrl = `${winnerSolver.callbackUrl}/execute`
        const executePayload = {
          intentId:        order.orderId,
          intent:          pendingIntent.intent,
          signature:       pendingIntent.signature,
          contractAddress: EXECUTE_CONTRACT_ADDRESS,
          chainId:         EXECUTE_CHAIN_ID,
          rpcUrl:          EXECUTE_RPC_URL,
        }
        // Fire-and-forget with timeout — solver processes async
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), EXECUTE_TIMEOUT_MS)
        fetch(executeUrl, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(executePayload),
          signal:  ctrl.signal,
        })
          .then(async (r) => {
            clearTimeout(timer)
            const body = await r.json().catch(() => ({}))
            if (r.ok) {
              logger.info({ orderId: order.orderId, winner, txHash: (body as Record<string, unknown>)['tx_hash'] }, '[RFQ] Execute signal sent — solver is executing intent')
              // Clear exclusive window so checkFades() does not penalise an actively executing solver
              clearPendingExclusive(order.orderId)
              solverEvents.emit('execute_sent', {
                type: 'execute_sent',
                orderId: order.orderId,
                data: { winner, txHash: (body as Record<string, unknown>)['tx_hash'] ?? null },
              } satisfies SolverProgressEvent)
            } else {
              logger.warn({ orderId: order.orderId, status: r.status, body }, '[RFQ] Solver /execute returned error')
            }
          })
          .catch((err: unknown) => {
            clearTimeout(timer)
            logger.warn({ orderId: order.orderId, err }, '[RFQ] Failed to send execute signal to solver')
          })
      }
      // Non-gasless orders (old createOrder flow): solver detects via EVM WS — no signal needed
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
  // NOTE: orderId must be provided for frontend to match the event to the correct order
  solverEvents.emit('order_fulfilled', {
    type: 'order_fulfilled',
    orderId: orderId ?? '-',
    data: {
      solverName: solver.name,
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
        solver.suspended   = true
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

// ============================================================================
// Token verification helper
// ============================================================================

export function verifySolverToken(token: string): SolverInfo | null {
  const id = byToken.get(token)
  if (!id) return null
  return registry.get(id) ?? null
}

// ============================================================================
// Step reporting (sol_sent / vaa_ready from solver → frontend via SSE)
// ============================================================================

export function reportStep(
  token: string,
  body: { orderId: string; type: 'sol_sent' | 'vaa_ready'; txHash?: string }
): boolean {
  const solver = verifySolverToken(token)
  if (!solver) return false

  const eventData: SolverProgressEvent = {
    type:    body.type,
    orderId: body.orderId,
    data:    {
      solverName: solver.name,
      ...(body.txHash ? { txHash: body.txHash } : {}),
    },
  }

  solverEvents.emit(body.type, eventData)

  logger.info(
    { orderId: body.orderId, type: body.type, txHash: body.txHash, solver: solver.name },
    '[Solver] Step reported'
  )

  return true
}
