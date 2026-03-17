/**
 * Intent Indexer
 *
 * Background worker yang terus poll on-chain events dari EVM (Base Sepolia + Fuji)
 * dan Solana, lalu simpan ke in-memory store.
 *
 * Frontend dan SSE /watch cukup baca dari store ini — tidak perlu hit RPC langsung.
 *
 * Flow:
 *   startIndexer() → run immediately + setInterval tiap POLL_INTERVAL_MS
 *   IndexerStore    → Map<orderId, IntentOrder>
 *   EventEmitter    → emit('order_update', order) saat status berubah
 */

import EventEmitter from 'events'
import {
  createPublicClient,
  http,
  formatEther,
} from 'viem'
import { baseSepolia, avalancheFuji } from 'viem/chains'
import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js'
import * as anchor from '@coral-xyz/anchor'
import { config } from '@config/env'
import { logger } from '@lib/logger'
import { INTENT_BRIDGE } from '@config/constants'
import type { IntentOrder, SupportedChain } from './intent.service'

// ============================================================================
// Config
// ============================================================================

const POLL_INTERVAL_MS = 10_000   // poll tiap 10 detik
const BLOCK_WINDOW     = 9_999n   // max getLogs range per chunk (Base Sepolia limit)
const MAX_WINDOWS      = 6        // 6 × 10k = ~60k blocks ≈ 50 days

// ============================================================================
// ABI (minimal)
// ============================================================================

const ORDER_CREATED_EVENT = {
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
    { name: 'withStake',        type: 'bool',    indexed: false },
  ],
} as const

const ORDER_FULFILLED_EVENT = {
  name: 'OrderFulfilled',
  type: 'event',
  inputs: [
    { name: 'orderId', type: 'bytes32', indexed: true  },
    { name: 'solver',  type: 'address', indexed: true  },
    { name: 'amount',  type: 'uint256', indexed: false },
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
      { name: 'withStake',        type: 'bool'     },
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

// key = orderId (hex) or Solana account pubkey
const store = new Map<string, IntentOrder>()

// per-creator index: creator address (lowercase) → Set<orderId>
const byCreator = new Map<string, Set<string>>()

// Global event emitter — SSE route subscribes to this
export const indexerEvents = new EventEmitter()
indexerEvents.setMaxListeners(200)

// ── Store helpers ─────────────────────────────────────────────────────────────

function upsert(order: IntentOrder): void {
  const prev = store.get(order.orderId)
  store.set(order.orderId, order)

  const creatorKey = order.creator.toLowerCase()
  if (!byCreator.has(creatorKey)) byCreator.set(creatorKey, new Set())
  byCreator.get(creatorKey)!.add(order.orderId)

  // Emit only when status changes (or first insert)
  const prevStatus = prev?.status
  const newStatus  = order.status
  if (prevStatus !== newStatus) {
    indexerEvents.emit('order_update', order)
    if (prev) {
      logger.info({ orderId: order.orderId, prevStatus, newStatus }, 'Order status changed')
    }
  }
}

// ── Public read API ───────────────────────────────────────────────────────────

export function getOrdersByCreator(creator: string, chain?: SupportedChain): IntentOrder[] {
  const creatorKey = creator.toLowerCase()
  const ids = byCreator.get(creatorKey)
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
    totalOrders: store.size,
    lastPollAt:  lastPollAt ? new Date(lastPollAt).toISOString() : null,
    isRunning,
  }
}

// ============================================================================
// EVM Indexer
// ============================================================================

function statusLabel(s: number): 'OPEN' | 'FULFILLED' | 'CANCELLED' {
  if (s === INTENT_BRIDGE.STATUS.OPEN)      return 'OPEN'
  if (s === INTENT_BRIDGE.STATUS.FULFILLED) return 'FULFILLED'
  return 'CANCELLED'
}

function evmExplorer(chain: SupportedChain, hash: string): string {
  return chain === 'evm-base'
    ? `https://sepolia.basescan.org/tx/${hash}`
    : `https://testnet.snowtrace.io/tx/${hash}`
}

// Track highest indexed block per chain to avoid re-scanning
const highWaterMark = new Map<string, bigint>()

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function indexEvmChain(
  evmChain: 'evm-base' | 'evm-fuji',
  client:   any,
  contract: `0x${string}`,
): Promise<void> {
  const latest = await client.getBlockNumber()
  const hwKey  = evmChain

  // First run: scan back MAX_WINDOWS * BLOCK_WINDOW blocks
  // Subsequent runs: only scan new blocks since last high water mark
  const hwm = highWaterMark.get(hwKey)
  let fromBlock: bigint
  if (hwm) {
    fromBlock = hwm + 1n
    if (fromBlock > latest) return // nothing new
  } else {
    const floor = latest > BigInt(MAX_WINDOWS) * BLOCK_WINDOW
      ? latest - BigInt(MAX_WINDOWS) * BLOCK_WINDOW
      : 0n
    fromBlock = floor
  }

  // Collect all OrderCreated + OrderFulfilled in range, chunked
  type RawLog = { args: Record<string, unknown>; transactionHash: `0x${string}` | null; blockNumber: bigint | null }
  const createdLogs:   RawLog[] = []
  const fulfilledLogs: RawLog[] = []

  for (let from = fromBlock; from <= latest; from += BLOCK_WINDOW + 1n) {
    const to = from + BLOCK_WINDOW > latest ? latest : from + BLOCK_WINDOW
    await Promise.all([
      client.getLogs({ address: contract, event: ORDER_CREATED_EVENT,   fromBlock: from, toBlock: to })
        .then((r: unknown[]) => createdLogs.push(...r as RawLog[]))
        .catch(() => {}),
      client.getLogs({ address: contract, event: ORDER_FULFILLED_EVENT, fromBlock: from, toBlock: to })
        .then((r: unknown[]) => fulfilledLogs.push(...r as RawLog[]))
        .catch(() => {}),
    ])
  }

  // Build fulfill map: orderId → { txHash, solver }
  const fulfillMap = new Map<string, { txHash: string; solver: string }>()
  for (const log of fulfilledLogs) {
    const orderId = (log.args['orderId'] as string | undefined)?.toLowerCase()
    const solver  = (log.args['solver']  as string | undefined) ?? ''
    const txHash  = log.transactionHash ?? ''
    if (orderId) fulfillMap.set(orderId, { txHash, solver })
  }

  // Process each OrderCreated
  await Promise.allSettled(createdLogs.map(async (log) => {
    const orderId = log.args['orderId'] as `0x${string}` | undefined
    const creator = log.args['creator'] as string | undefined
    if (!orderId || !creator) return

    // Read full on-chain order state
    const raw = await client.readContract({
      address: contract,
      abi: ORDERS_FUNCTION_ABI,
      functionName: 'orders',
      args: [orderId],
    }) as readonly [string, `0x${string}`, number, bigint, bigint, bigint, bigint, bigint, number, boolean]

    const [, recipient, destChain, amount, startPrice, floorPrice, deadline, createdAt, statusNum, withStake] = raw
    const isOpen = statusNum === INTENT_BRIDGE.STATUS.OPEN

    let currentPrice: string | null = null
    if (isOpen && Date.now() / 1000 < Number(deadline)) {
      currentPrice = await client.readContract({
        address: contract,
        abi: ORDERS_FUNCTION_ABI,
        functionName: 'getAuctionPrice',
        args: [orderId],
      }).then((p: unknown) => (p as bigint).toString()).catch(() => null)
    }

    const fulfillInfo = fulfillMap.get(orderId.toLowerCase())

    upsert({
      orderId,
      chain:            evmChain,
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
      status:           fulfillInfo ? 'FULFILLED' : statusLabel(statusNum),
      withStake:        withStake ?? false,
      explorerUrl:      evmExplorer(evmChain, log.transactionHash ?? ''),
    })
  }))

  // Also re-check existing OPEN orders on this chain to catch status changes
  const openOrders = Array.from(store.values()).filter(
    o => o.chain === evmChain && o.status === 'OPEN'
  )
  await Promise.allSettled(openOrders.map(async (o) => {
    try {
      const raw = await client.readContract({
        address: contract,
        abi: ORDERS_FUNCTION_ABI,
        functionName: 'orders',
        args: [o.orderId as `0x${string}`],
      }) as readonly [string, `0x${string}`, number, bigint, bigint, bigint, bigint, bigint, number]
      const statusNum = raw[8]
      if (statusNum !== INTENT_BRIDGE.STATUS.OPEN) {
        upsert({ ...o, status: statusLabel(statusNum), currentPrice: null })
      }
    } catch { /* skip */ }
  }))

  highWaterMark.set(hwKey, latest)
}

// ============================================================================
// Solana Indexer
// ============================================================================

const SOL_DISCRIMINATOR = Buffer.from(
  anchor.utils.sha256.hash('account:Intent').slice(0, 8)
)

async function indexSolana(connection: Connection, programId: PublicKey): Promise<void> {
  // Fetch all intent accounts (no creator filter — index everything)
  const accounts = await connection.getProgramAccounts(programId, {
    filters: [
      { memcmp: { offset: 0, bytes: SOL_DISCRIMINATOR.toString('base64'), encoding: 'base64' as const } },
    ],
  })

  for (const { pubkey, account } of accounts) {
    try {
      const buf = account.data
      if (buf.length < 148) continue
      let off = 8 // skip discriminator

      const intentId        = buf.slice(off, off + 32).toString('hex'); off += 32
      const creatorBytes    = buf.slice(off, off + 32);                  off += 32
      const recipient       = buf.slice(off, off + 32).toString('hex'); off += 32
      const destinationChain = buf.readUInt16LE(off);                   off += 2
      const amount          = buf.readBigUInt64LE(off);                  off += 8
      const startPrice      = buf.readBigUInt64LE(off);                  off += 8
      const floorPrice      = buf.readBigUInt64LE(off);                  off += 8
      const deadline        = buf.readBigInt64LE(off);                   off += 8
      const createdAt       = buf.readBigInt64LE(off);                   off += 8
      const statusByte      = buf[off]

      const creator = new PublicKey(creatorBytes).toBase58()

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
        explorerUrl:      `https://explorer.solana.com/address/${pubkey.toBase58()}?cluster=devnet`,
      })
    } catch { /* skip malformed account */ }
  }
}

// ============================================================================
// Main poll loop
// ============================================================================

let isRunning   = false
let lastPollAt: number | null = null
let pollTimer:  ReturnType<typeof setTimeout> | null = null

async function poll(): Promise<void> {
  lastPollAt = Date.now()

  const baseClient = createPublicClient({ chain: baseSepolia, transport: http(config.intent.evm.baseSepolia.rpcUrl) })
  const fujiClient = createPublicClient({ chain: avalancheFuji, transport: http(config.intent.evm.fuji.rpcUrl) })
  const solConn    = new Connection(config.solana.rpcUrl, 'confirmed')
  const solProgram = new PublicKey(config.intent.solana.programId)

  await Promise.allSettled([
    indexEvmChain('evm-base', baseClient, config.intent.evm.baseSepolia.contract),
    indexEvmChain('evm-fuji', fujiClient, config.intent.evm.fuji.contract),
    indexSolana(solConn, solProgram),
  ])

  logger.debug({ orders: store.size }, 'Indexer poll complete')
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

export function startIndexer(): void {
  if (isRunning) return
  isRunning = true
  logger.info('Intent indexer starting')

  const run = async () => {
    try {
      await poll()
    } catch (err) {
      logger.error({ err }, 'Indexer poll failed')
    } finally {
      if (isRunning) {
        pollTimer = setTimeout(run, POLL_INTERVAL_MS)
      }
    }
  }

  run()
}

export function stopIndexer(): void {
  isRunning = false
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
  logger.info('Intent indexer stopped')
}
