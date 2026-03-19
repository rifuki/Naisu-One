/**
 * Intent Indexer — WS-first, event-driven
 *
 * Architecture:
 *   1. Initial backfill  — getLogs (EVM) + getProgramAccounts (Solana)
 *   2. WS real-time      — viem watchContractEvent (eth_subscribe) + Solana onProgramAccountChange
 *   3. HTTP poll fallback — if BASE_SEPOLIA_WS_URL not set (10s interval)
 *
 * Why WS-first?
 *   Solver resolves intents in ~15s via WS. HTTP polling at 10s would miss
 *   the OPEN window. WS gives sub-second latency on every status change.
 *
 * Flow:
 *   startIndexer()
 *     → start WS subscriptions first   (buffers events during backfill)
 *     → run initial backfill            (catches historical orders)
 *     → WS continues streaming forever
 *
 *   stopIndexer()
 *     → unwatch all WS subscriptions
 *     → clear poll timer (if in fallback mode)
 */

import EventEmitter from 'events'
import { createPublicClient, http, webSocket, formatEther } from 'viem'
import { baseSepolia } from 'viem/chains'
import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  type AccountInfo,
} from '@solana/web3.js'
import { BorshAccountsCoder } from '@coral-xyz/anchor'
import IntentBridgeIDL from '../idl/intent_bridge_solana.json'
import { config } from '@config/env'
import { logger } from '@lib/logger'
import { INTENT_BRIDGE } from '@config/constants'
import type { IntentOrder, SupportedChain } from './intent.service'

// ============================================================================
// Config
// ============================================================================

const POLL_INTERVAL_MS = 10_000   // fallback HTTP poll interval
const BLOCK_WINDOW     = 1_999n   // max getLogs range per chunk (Base Sepolia RPC limits >2000)
const MAX_WINDOWS      = 30       // 30 × 2k = ~60k blocks ≈ 50 days

// ============================================================================
// ABIs (minimal)
// ============================================================================

const ORDER_CREATED_ABI = {
  name: 'OrderCreated',
  type: 'event',
  inputs: [
    { name: 'orderId',          type: 'bytes32', indexed: true  },
    { name: 'creator',          type: 'address', indexed: true  },
    { name: 'recipient',        type: 'bytes32', indexed: false },
    { name: 'destinationChain', type: 'uint16',  indexed: false },
    { name: 'amount',           type: 'uint256', indexed: false },
    { name: 'startPrice',       type: 'uint256', indexed: false },
    { name: 'floorPrice',       type: 'uint256', indexed: false },
    { name: 'deadline',         type: 'uint256', indexed: false },
    { name: 'intentType',       type: 'uint8',   indexed: false },
  ],
} as const

const ORDER_FULFILLED_ABI = {
  name: 'OrderFulfilled',
  type: 'event',
  inputs: [
    { name: 'orderId', type: 'bytes32', indexed: true  },
    { name: 'solver',  type: 'address', indexed: true  },
  ],
} as const

const ORDERS_FUNCTION_ABI = [
  {
    name: 'orders',
    type: 'function',
    stateMutability: 'view',
    inputs:  [{ name: 'orderId', type: 'bytes32' }],
    outputs: [
      { name: 'creator',          type: 'address'  },
      { name: 'recipient',        type: 'bytes32'  },
      { name: 'destinationChain', type: 'uint16'   },
      { name: 'amount',           type: 'uint256'  },
      { name: 'startPrice',       type: 'uint256'  },
      { name: 'floorPrice',       type: 'uint256'  },
      { name: 'deadline',         type: 'uint256'  },
      { name: 'createdAt',        type: 'uint256'  },
      { name: 'status',           type: 'uint8'    },
      { name: 'intentType',       type: 'uint8'    },
      { name: 'exclusiveSolver',  type: 'address'  },
      { name: 'exclusivityDeadline', type: 'uint256' },
    ],
  },
  {
    name: 'getAuctionPrice',
    type: 'function',
    stateMutability: 'view',
    inputs:  [{ name: 'orderId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

// ============================================================================
// Store
// ============================================================================

const store    = new Map<string, IntentOrder>()
const byCreator = new Map<string, Set<string>>()

export const indexerEvents = new EventEmitter()
indexerEvents.setMaxListeners(200)

function upsert(order: IntentOrder): void {
  const prev      = store.get(order.orderId)
  store.set(order.orderId, order)

  const creatorKey = order.creator.toLowerCase()
  if (!byCreator.has(creatorKey)) byCreator.set(creatorKey, new Set())
  byCreator.get(creatorKey)!.add(order.orderId)

  const prevStatus = prev?.status
  const newStatus  = order.status
  if (!prev) {
    indexerEvents.emit('order_created', order)
  } else if (prevStatus !== newStatus) {
    indexerEvents.emit('order_update', order)
    logger.info({ orderId: order.orderId, prevStatus, newStatus }, 'Order status changed')
  }
}

// ── Public write API — gasless intents ───────────────────────────────────────

/**
 * Inject a gasless (off-chain signed) intent into the indexer store so that
 * Active Intents widget shows it as OPEN while waiting for solver execution.
 */
export function injectGaslessOrder(params: {
  intentId: string
  creator: string
  recipient: string
  destinationChain: number  // Wormhole chain ID (1=Solana, 21=Sui)
  amount: string            // human-readable ETH amount
  amountRaw: string         // amount in wei
  startPrice: string        // in destination base units (lamports / mist)
  floorPrice: string
  deadline: number          // unix seconds
  intentType: number
}): void {
  const order: IntentOrder = {
    orderId:          params.intentId,
    chain:            'evm-base',
    creator:          params.creator,
    recipient:        params.recipient,
    destinationChain: params.destinationChain,
    amount:           params.amount,
    amountRaw:        params.amountRaw,
    startPrice:       params.startPrice,
    floorPrice:       params.floorPrice,
    currentPrice:     params.startPrice,
    deadline:         params.deadline * 1000,  // sec → ms
    createdAt:        Date.now(),
    status:           'OPEN',
    intentType:       params.intentType,
    explorerUrl:      '',  // no on-chain tx yet — solver will submit
    isGasless:        true,
  }
  upsert(order)
}

/**
 * Cancel a gasless order in the indexer store (off-chain cancel, no on-chain tx)
 */
export function cancelIndexedOrder(orderId: string): boolean {
  const order = store.get(orderId)
  if (!order) return false
  upsert({ ...order, status: 'CANCELLED' })
  return true
}

// ── Public read API ───────────────────────────────────────────────────────────

export function getOrdersByCreator(creator: string, chain?: SupportedChain): IntentOrder[] {
  const creatorKey = creator.toLowerCase()
  const ids        = byCreator.get(creatorKey)
  if (!ids) return []

  const orders: IntentOrder[] = []
  for (const id of ids) {
    const o = store.get(id)
    if (o && (!chain || o.chain === chain)) orders.push(o)
  }
  return orders.sort((a, b) => b.createdAt - a.createdAt)
}

export function getAllOrders(): IntentOrder[] {
  return Array.from(store.values()).sort((a, b) => b.createdAt - a.createdAt)
}

export function getIndexerStatus() {
  return {
    mode:        config.intent.evm.baseSepolia.wsUrl ? 'WS' : 'HTTP_POLL',
    totalOrders: store.size,
    lastPollAt:  lastPollAt ? new Date(lastPollAt).toISOString() : null,
    isRunning,
  }
}

// ============================================================================
// Helpers
// ============================================================================

function statusLabel(s: number): 'OPEN' | 'FULFILLED' | 'CANCELLED' {
  if (s === INTENT_BRIDGE.STATUS.OPEN)      return 'OPEN'
  if (s === INTENT_BRIDGE.STATUS.FULFILLED) return 'FULFILLED'
  return 'CANCELLED'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

/**
 * Fetch full order state from contract and upsert into store.
 * Used by both initial backfill and WS OrderCreated handler.
 */
async function processEvmOrder(
  client:   AnyClient,
  contract: `0x${string}`,
  orderId:  `0x${string}`,
  creator:  string,
  txHash:   string,
): Promise<void> {
  try {
    const raw = await client.readContract({
      address:      contract,
      abi:          ORDERS_FUNCTION_ABI,
      functionName: 'orders',
      args:         [orderId],
    }) as readonly [string, `0x${string}`, number, bigint, bigint, bigint, bigint, bigint, number, number, string, bigint]

    const [, recipient, destChain, amount, startPrice, floorPrice, deadline, createdAt, statusNum, intentType] = raw
    const isOpen = statusNum === INTENT_BRIDGE.STATUS.OPEN

    let currentPrice: string | null = null
    if (isOpen && Date.now() / 1000 < Number(deadline)) {
      currentPrice = await client.readContract({
        address:      contract,
        abi:          ORDERS_FUNCTION_ABI,
        functionName: 'getAuctionPrice',
        args:         [orderId],
      }).then((p: unknown) => (p as bigint).toString()).catch(() => null)
    }

    const onchainOrder: IntentOrder = {
      orderId,
      chain:            'evm-base',
      creator:          creator.toLowerCase(),
      recipient:        (recipient as string).replace('0x', ''),
      destinationChain: destChain,
      amount:           formatEther(amount),
      amountRaw:        amount.toString(),
      startPrice:       startPrice.toString(),
      floorPrice:       floorPrice.toString(),
      currentPrice,
      deadline:         Number(deadline) * 1000,
      createdAt:        Number(createdAt) * 1000,
      status:           statusLabel(statusNum),
      intentType:       intentType ?? 0,
      explorerUrl:      `https://sepolia.basescan.org/tx/${txHash}`,
    }

    // Remove matching injected gasless order to prevent double entries in the widget.
    // The contract orderId (keccak256) never matches the backend intentId (hex timestamp),
    // so we match by creator + amountRaw + deadline instead.
    const creatorKey = creator.toLowerCase()
    const creatorIds = byCreator.get(creatorKey)
    if (creatorIds) {
      for (const id of creatorIds) {
        const existing = store.get(id)
        if (existing?.isGasless && existing.amountRaw === amount.toString() && existing.deadline === Number(deadline) * 1000) {
          store.delete(id)
          creatorIds.delete(id)
          logger.info({ gaslessId: id, onchainOrderId: orderId }, '[EVM] Merged gasless injected order → on-chain order')
          indexerEvents.emit('gasless_resolved', { intentId: id, contractOrderId: orderId })
          break
        }
      }
    }

    upsert(onchainOrder)
  } catch (err) {
    logger.warn({ err, orderId }, '[EVM] Failed to process order')
  }
}

// ============================================================================
// EVM — Initial backfill (getLogs)
// ============================================================================

const highWaterMark = new Map<string, bigint>()

async function initialEvmBackfill(client: AnyClient, contract: `0x${string}`): Promise<void> {
  const latest = await client.getBlockNumber()
  const hwm    = highWaterMark.get('evm-base')
  let fromBlock: bigint

  if (hwm) {
    fromBlock = hwm + 1n
    if (fromBlock > latest) return
  } else {
    const floor = latest > BigInt(MAX_WINDOWS) * BLOCK_WINDOW
      ? latest - BigInt(MAX_WINDOWS) * BLOCK_WINDOW
      : 0n
    fromBlock = floor
  }

  type RawLog = { args: Record<string, unknown>; transactionHash: `0x${string}` | null }
  const createdLogs:   RawLog[] = []
  const fulfilledLogs: RawLog[] = []

  for (let from = fromBlock; from <= latest; from += BLOCK_WINDOW + 1n) {
    const to = from + BLOCK_WINDOW > latest ? latest : from + BLOCK_WINDOW
    await Promise.all([
      client.getLogs({ address: contract, event: ORDER_CREATED_ABI,   fromBlock: from, toBlock: to })
        .then((r: unknown[]) => createdLogs.push(...r as RawLog[]))
        .catch((e: Error) => logger.warn({ err: e.message, from: from.toString(), to: to.toString() }, '[EVM] getLogs OrderCreated failed')),
      client.getLogs({ address: contract, event: ORDER_FULFILLED_ABI, fromBlock: from, toBlock: to })
        .then((r: unknown[]) => fulfilledLogs.push(...r as RawLog[]))
        .catch((e: Error) => logger.warn({ err: e.message, from: from.toString(), to: to.toString() }, '[EVM] getLogs OrderFulfilled failed')),
    ])
  }

  // Mark fulfilled orders
  const fulfillMap = new Map<string, string>()
  for (const log of fulfilledLogs) {
    const orderId = (log.args['orderId'] as string | undefined)?.toLowerCase()
    if (orderId) fulfillMap.set(orderId, log.transactionHash ?? '')
  }

  await Promise.allSettled(createdLogs.map(async (log) => {
    const orderId = log.args['orderId'] as `0x${string}` | undefined
    const creator = log.args['creator'] as string | undefined
    if (!orderId || !creator) return
    await processEvmOrder(client, contract, orderId, creator, log.transactionHash ?? '')
    // Override status if fulfilled log found
    const fulfillTx = fulfillMap.get(orderId.toLowerCase())
    if (fulfillTx) {
      const existing = store.get(orderId)
      if (existing) upsert({ ...existing, status: 'FULFILLED', currentPrice: null, fulfillTxHash: fulfillTx || undefined })
    }
  }))

  // Re-check existing OPEN orders to catch status changes
  const openOrders = Array.from(store.values()).filter(o => o.chain === 'evm-base' && o.status === 'OPEN')
  await Promise.allSettled(openOrders.map(async (o) => {
    try {
      const raw = await client.readContract({
        address: contract, abi: ORDERS_FUNCTION_ABI, functionName: 'orders', args: [o.orderId as `0x${string}`],
      }) as readonly unknown[]
      const statusNum = raw[8] as number
      if (statusNum !== INTENT_BRIDGE.STATUS.OPEN) {
        upsert({ ...o, status: statusLabel(statusNum), currentPrice: null })
      }
    } catch { /* skip */ }
  }))

  highWaterMark.set('evm-base', latest)
  logger.debug({ orders: store.size, fromBlock: fromBlock.toString(), toBlock: latest.toString() }, '[EVM] Backfill complete')
}

// ============================================================================
// EVM — WS subscription (eth_subscribe via viem webSocket transport)
// ============================================================================

function startEvmWsSubscription(
  wsUrl:      string,
  contract:   `0x${string}`,
  httpClient: AnyClient,
): () => void {
  const wsClient = createPublicClient({
    chain:     baseSepolia,
    transport: webSocket(wsUrl, { reconnect: { attempts: Infinity, delay: 3_000 } }),
  })

  const unwatchCreated = wsClient.watchContractEvent({
    address:      contract,
    abi:          [ORDER_CREATED_ABI],
    eventName:    'OrderCreated',
    onLogs:       async (logs) => {
      for (const log of logs) {
        const { orderId, creator } = log.args as { orderId: `0x${string}`; creator: `0x${string}` }
        logger.info({ orderId }, '[EVM WS] OrderCreated — processing')
        await processEvmOrder(httpClient, contract, orderId, creator, log.transactionHash ?? '')
      }
    },
    onError: (err) => logger.warn({ err }, '[EVM WS] OrderCreated error'),
  })

  const unwatchFulfilled = wsClient.watchContractEvent({
    address:   contract,
    abi:       [ORDER_FULFILLED_ABI],
    eventName: 'OrderFulfilled',
    onLogs:    (logs) => {
      for (const log of logs) {
        const { orderId } = log.args as { orderId: `0x${string}` }
        logger.info({ orderId }, '[EVM WS] OrderFulfilled — updating status')
        const existing = store.get(orderId)
        if (existing) {
          upsert({ ...existing, status: 'FULFILLED', currentPrice: null, fulfillTxHash: log.transactionHash ?? undefined })
        } else {
          // Edge case: fulfilled before we indexed the created event
          // Re-run backfill to pick it up
          initialEvmBackfill(httpClient, contract).catch(() => {})
        }
      }
    },
    onError: (err) => logger.warn({ err }, '[EVM WS] OrderFulfilled error'),
  })

  logger.info({ wsUrl, contract }, '[EVM WS] Subscribed — OrderCreated + OrderFulfilled')
  return () => { unwatchCreated(); unwatchFulfilled() }
}

// ============================================================================
// Solana — Initial backfill (getProgramAccounts)
// ============================================================================

const _intentAccountDef = IntentBridgeIDL.accounts.find(a => a.name === 'Intent')!
const SOL_DISCRIMINATOR  = Buffer.from(_intentAccountDef.discriminator)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _intentCoder       = new BorshAccountsCoder(IntentBridgeIDL as any)

function decodeSolanaAccount(pubkey: PublicKey, data: Buffer): void {
  try {
    const decoded          = _intentCoder.decode('intent', data)
    const intentId         = Buffer.from(decoded.intentId as number[]).toString('hex')
    const creator          = new PublicKey(decoded.creator as Uint8Array).toBase58()
    const recipient        = Buffer.from(decoded.recipient as number[]).toString('hex')
    const destinationChain = decoded.destinationChain as number
    const amount           = BigInt((decoded.amount as { toString(): string }).toString())
    const startPrice       = BigInt((decoded.startPrice as { toString(): string }).toString())
    const floorPrice       = BigInt((decoded.floorPrice as { toString(): string }).toString())
    const deadline         = BigInt((decoded.deadline as { toString(): string }).toString())
    const createdAt        = BigInt((decoded.createdAt as { toString(): string }).toString())
    const statusByte       = decoded.status as number

    const nowSec = BigInt(Math.floor(Date.now() / 1000))
    let currentPrice: string | null = null
    if (statusByte === INTENT_BRIDGE.STATUS.OPEN && nowSec < deadline) {
      const elapsed       = nowSec - createdAt
      const totalDuration = deadline - createdAt
      const priceRange    = startPrice - floorPrice
      if (totalDuration > 0n) {
        currentPrice = (startPrice - (priceRange * elapsed) / totalDuration).toString()
      }
    }

    let solStatus: 'OPEN' | 'FULFILLED' | 'CANCELLED' = 'CANCELLED'
    if (statusByte === INTENT_BRIDGE.STATUS.OPEN)      solStatus = 'OPEN'
    if (statusByte === INTENT_BRIDGE.STATUS.FULFILLED) solStatus = 'FULFILLED'

    upsert({
      orderId:          '0x' + intentId,
      chain:            'solana',
      creator,
      recipient,
      destinationChain,
      amount:           (Number(amount) / LAMPORTS_PER_SOL).toFixed(9),
      amountRaw:        amount.toString(),
      startPrice:       startPrice.toString(),
      floorPrice:       floorPrice.toString(),
      currentPrice,
      deadline:         Number(deadline) * 1000,
      createdAt:        Number(createdAt) * 1000,
      status:           solStatus,
      intentType:       0,
      explorerUrl:      `https://explorer.solana.com/address/${pubkey.toBase58()}?cluster=devnet`,
    })
  } catch { /* skip malformed account */ }
}

async function initialSolanaBackfill(connection: Connection, programId: PublicKey): Promise<void> {
  const accounts = await connection.getProgramAccounts(programId, {
    filters: [
      { memcmp: { offset: 0, bytes: SOL_DISCRIMINATOR.toString('base64'), encoding: 'base64' as const } },
    ],
  })
  for (const { pubkey, account } of accounts) {
    decodeSolanaAccount(pubkey, account.data)
  }
  logger.debug({ accounts: accounts.length }, '[Solana] Backfill complete')
}

// ============================================================================
// Solana — WS subscription (onProgramAccountChange via @solana/web3.js)
// ============================================================================

function startSolanaWsSubscription(
  connection: Connection,
  programId:  PublicKey,
): () => Promise<void> {
  const subId = connection.onProgramAccountChange(
    programId,
    ({ accountId, accountInfo }: { accountId: PublicKey; accountInfo: AccountInfo<Buffer> }) => {
      logger.debug({ account: accountId.toBase58() }, '[Solana WS] Account changed — decoding')
      decodeSolanaAccount(accountId, accountInfo.data)
    },
    'confirmed',
    [{ memcmp: { offset: 0, bytes: SOL_DISCRIMINATOR.toString('base64'), encoding: 'base64' as const } }],
  )

  logger.info({ program: programId.toBase58() }, '[Solana WS] Subscribed — onProgramAccountChange')
  return async () => { await connection.removeProgramAccountChangeListener(subId) }
}

// ============================================================================
// HTTP polling fallback
// ============================================================================

async function poll(client: AnyClient, contract: `0x${string}`, connection: Connection, programId: PublicKey): Promise<void> {
  lastPollAt = Date.now()
  await Promise.allSettled([
    initialEvmBackfill(client, contract),
    initialSolanaBackfill(connection, programId),
  ])
  logger.debug({ orders: store.size }, '[Indexer] Poll complete')
}

// ============================================================================
// Lifecycle
// ============================================================================

let isRunning  = false
let lastPollAt: number | null = null
let pollTimer:  ReturnType<typeof setTimeout> | null = null
const cleanupFns: Array<() => void | Promise<void>> = []

export async function startIndexer(): Promise<void> {
  if (isRunning) return
  isRunning = true

  const { wsUrl, rpcUrl, contract } = config.intent.evm.baseSepolia
  const httpClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) })
  const solConn    = new Connection(config.solana.rpcUrl, 'confirmed')
  const solProgram = new PublicKey(config.intent.solana.programId)

  if (wsUrl) {
    logger.info({ contract }, 'Intent indexer: WS mode')

    // Subscribe first — buffers any events that arrive during backfill
    const cleanupEvm = startEvmWsSubscription(wsUrl, contract, httpClient)
    const cleanupSol = startSolanaWsSubscription(solConn, solProgram)
    cleanupFns.push(cleanupEvm, cleanupSol)

    // Then backfill historical orders
    await Promise.allSettled([
      initialEvmBackfill(httpClient, contract),
      initialSolanaBackfill(solConn, solProgram),
    ])
    logger.info({ orders: store.size }, 'Intent indexer: backfill complete, WS streaming active')

    // Safety net: re-check OPEN orders every 30s in case WS events are missed/delayed
    const recheckTimer = setInterval(async () => {
      const openOrders = Array.from(store.values()).filter(o => o.chain === 'evm-base' && o.status === 'OPEN')
      if (openOrders.length === 0) return
      await Promise.allSettled(openOrders.map(async (o) => {
        try {
          const raw = await httpClient.readContract({
            address: contract, abi: ORDERS_FUNCTION_ABI, functionName: 'orders', args: [o.orderId as `0x${string}`],
          }) as readonly unknown[]
          const statusNum = raw[8] as number
          if (statusNum !== INTENT_BRIDGE.STATUS.OPEN) {
            logger.info({ orderId: o.orderId, status: statusLabel(statusNum) }, '[EVM] OPEN order re-check: status changed')
            upsert({ ...o, status: statusLabel(statusNum), currentPrice: null })
          }
        } catch { /* skip */ }
      }))
    }, 30_000)
    cleanupFns.push(() => clearInterval(recheckTimer))
  } else {
    logger.info('Intent indexer: HTTP polling mode (set BASE_SEPOLIA_WS_URL for real-time)')
    const run = async () => {
      try { await poll(httpClient, contract, solConn, solProgram) }
      catch (err) { logger.error({ err }, 'Indexer poll failed') }
      finally { if (isRunning) pollTimer = setTimeout(run, POLL_INTERVAL_MS) }
    }
    run()
  }
}

export function stopIndexer(): void {
  isRunning = false
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
  for (const fn of cleanupFns) { void fn() }
  cleanupFns.length = 0
  logger.info('Intent indexer stopped')
}

// ── Re-export type used by SSE route ─────────────────────────────────────────
export type OrderUpdateEvent = {
  orderId:          string
  status:           'OPEN' | 'FULFILLED' | 'CANCELLED' | 'EXPIRED'
  prevStatus:       string
  chain:            SupportedChain
  amount:           string
  explorerUrl:      string
  destinationChain: number
}
