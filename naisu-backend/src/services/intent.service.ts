/**
 * Intent Bridge Service
 * Queries on-chain state across Sui, EVM (Fuji/Base Sepolia), and Solana
 * for the intent-bridge Dutch auction protocol.
 *
 * All write-path functions return unsigned transaction data for the frontend
 * to sign — the backend never holds private keys for user funds.
 */
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'
import { createPublicClient, http, parseEther, encodeFunctionData, formatEther } from 'viem'
import { avalancheFuji, baseSepolia } from 'viem/chains'
import {
  PublicKey,
  Connection,
  LAMPORTS_PER_SOL,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import * as anchor from '@coral-xyz/anchor'
import { config } from '@config/env'
import { logger } from '@lib/logger'
import { AppError } from '@utils/validation'
import { ERROR_CODES, INTENT_BRIDGE } from '@config/constants'

// ============================================================================
// Types
// ============================================================================

export type SupportedChain = 'sui' | 'evm-fuji' | 'evm-base' | 'solana'

function getChainDecimals(chain: SupportedChain): number {
  if (chain === 'sui') return 9
  if (chain === 'solana') return 9
  return 18 // evm-fuji, evm-base
}

export interface IntentQuote {
  fromChain: SupportedChain
  toChain: SupportedChain
  token: string
  amountIn: string          // human-readable (e.g. "1.0")
  amountInRaw: string       // base units
  currentAuctionPrice: string | null // base units on destination chain, null if no active orders
  estimatedReceive: string  // human-readable estimated receive amount
  floorPrice: string        // minimum price the auction accepts
  durationMs: number        // default auction duration
  wormholeFromChainId: number
  wormholeToChainId: number
}

export interface IntentOrder {
  orderId: string
  chain: SupportedChain
  creator: string
  recipient: string
  destinationChain: number  // Wormhole chain ID
  amount: string            // human-readable
  amountRaw: string
  startPrice: string
  floorPrice: string
  currentPrice: string | null
  deadline: number          // unix ms
  createdAt: number         // unix ms
  status: 'OPEN' | 'FULFILLED' | 'CANCELLED'
  explorerUrl: string
}

export interface CrossChainPrice {
  fromChain: SupportedChain
  toChain: SupportedChain
  rate: number              // 1 unit of fromChain token = rate units of toChain token
  fromToken: string
  toToken: string
  source: string            // where price data came from
  updatedAt: string         // ISO timestamp
}

// Unsigned EVM transaction
export interface EvmUnsignedTx {
  to: `0x${string}`
  data: `0x${string}`
  value: string             // wei, as decimal string
  chainId: number
  description: string
}

// Unsigned Sui transaction (base64 BCS bytes)
export interface SuiUnsignedTx {
  txBytes: string           // base64
  description: string
}

// Unsigned Solana transaction (base64 serialized VersionedTransaction)
export interface SolanaUnsignedTx {
  txBase64: string          // base64-encoded VersionedTransaction bytes (sign with wallet, broadcast)
  description: string
}

export type BuildTxResult =
  | { chain: 'sui'; tx: SuiUnsignedTx }
  | { chain: 'evm'; tx: EvmUnsignedTx }
  | { chain: 'solana'; tx: SolanaUnsignedTx }

// ============================================================================
// Clients (lazy singletons)
// ============================================================================

let _suiClient: SuiClient | null = null
function getSuiClient(): SuiClient {
  if (!_suiClient) {
    _suiClient = new SuiClient({ url: config.intent.sui.rpcUrl })
  }
  return _suiClient
}

function getFujiClient() {
  return createPublicClient({
    chain: avalancheFuji,
    transport: http(config.intent.evm.fuji.rpcUrl),
  })
}

function getBaseClient() {
  return createPublicClient({
    chain: baseSepolia,
    transport: http(config.intent.evm.baseSepolia.rpcUrl),
  })
}

let _solanaConn: Connection | null = null
function getSolanaConnection(): Connection {
  if (!_solanaConn) {
    _solanaConn = new Connection(config.solana.rpcUrl, 'confirmed')
  }
  return _solanaConn
}

// ============================================================================
// IntentBridge ABI (minimal — only what we need)
// ============================================================================

const INTENT_BRIDGE_ABI = [
  {
    name: 'createOrder',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'recipient', type: 'bytes32' },
      { name: 'destinationChain', type: 'uint16' },
      { name: 'startPrice', type: 'uint256' },
      { name: 'floorPrice', type: 'uint256' },
      { name: 'durationSeconds', type: 'uint256' },
      { name: 'withStake', type: 'bool' },
    ],
    outputs: [{ name: 'orderId', type: 'bytes32' }],
  },
  {
    name: 'getAuctionPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'orders',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    outputs: [
      { name: 'creator', type: 'address' },
      { name: 'recipient', type: 'bytes32' },
      { name: 'destinationChain', type: 'uint16' },
      { name: 'amount', type: 'uint256' },
      { name: 'startPrice', type: 'uint256' },
      { name: 'floorPrice', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'createdAt', type: 'uint256' },
      { name: 'status', type: 'uint8' },
    ],
  },
  {
    name: 'OrderCreated',
    type: 'event',
    inputs: [
      { name: 'orderId', type: 'bytes32', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'recipient', type: 'bytes32', indexed: false },
      { name: 'destinationChain', type: 'uint16', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'startPrice', type: 'uint256', indexed: false },
      { name: 'floorPrice', type: 'uint256', indexed: false },
      { name: 'deadline', type: 'uint256', indexed: false },
      { name: 'withStake', type: 'bool', indexed: false },
    ],
  },
] as const

// ============================================================================
// Helpers
// ============================================================================

function wormholeChainId(chain: SupportedChain): number {
  switch (chain) {
    case 'solana':   return INTENT_BRIDGE.WORMHOLE.SOLANA
    case 'sui':      return INTENT_BRIDGE.WORMHOLE.SUI
    case 'evm-base': return INTENT_BRIDGE.WORMHOLE.BASE_SEPOLIA
    case 'evm-fuji': return INTENT_BRIDGE.WORMHOLE.FUJI
  }
}

function statusLabel(status: number): 'OPEN' | 'FULFILLED' | 'CANCELLED' {
  switch (status) {
    case INTENT_BRIDGE.STATUS.OPEN:      return 'OPEN'
    case INTENT_BRIDGE.STATUS.FULFILLED: return 'FULFILLED'
    default:                             return 'CANCELLED'
  }
}

function evmExplorerTx(chain: SupportedChain, hash: string): string {
  if (chain === 'evm-fuji')
    return `https://testnet.snowtrace.io/tx/${hash}`
  return `https://sepolia.basescan.org/tx/${hash}`
}

// ============================================================================
// Sui — read intent state
// ============================================================================

/**
 * Compute Dutch auction price from Sui Intent object fields.
 * Mirrors the Move logic in intent_bridge.move :: get_auction_price().
 */
function computeSuiAuctionPrice(fields: Record<string, unknown>, nowMs: number): bigint {
  const startPrice  = BigInt(fields.start_price as string)
  const floorPrice  = BigInt(fields.floor_price as string)
  const deadline    = BigInt(fields.deadline as string)
  const createdAt   = BigInt(fields.created_at as string)
  const now         = BigInt(nowMs)

  if (now >= deadline) return floorPrice
  if (now <= createdAt) return startPrice

  const elapsed       = now - createdAt
  const totalDuration = deadline - createdAt
  const priceRange    = startPrice - floorPrice
  const decay         = (priceRange * elapsed) / totalDuration

  return startPrice - decay
}

/**
 * Fetch a Sui Intent object and return its fields.
 */
async function getSuiIntentFields(intentId: string): Promise<Record<string, unknown>> {
  const client = getSuiClient()
  const obj = await client.getObject({ id: intentId, options: { showContent: true } })

  if (!obj.data?.content || obj.data.content.dataType !== 'moveObject') {
    throw new AppError(`Intent object not found: ${intentId}`, 404, ERROR_CODES.NOT_FOUND)
  }

  return (obj.data.content as { fields: Record<string, unknown> }).fields
}

/**
 * List active Sui intents created by a given address.
 * Queries IntentCreated events and fetches each intent object.
 */
async function listSuiOrders(creator: string): Promise<IntentOrder[]> {
  const client = getSuiClient()
  const nowMs  = Date.now()

  // Query IntentCreated events from the package
  const events = await client.queryEvents({
    query: {
      MoveEventType: `${config.intent.sui.packageId}::intent_bridge::IntentCreated`,
    },
    limit: 50,
    order: 'descending',
  })

  const orders: IntentOrder[] = []

  for (const event of events.data) {
    const parsed = event.parsedJson as Record<string, unknown>
    if (creator && parsed.creator !== creator) continue

    const intentId = parsed.intent_id as string

    try {
      const fields = await getSuiIntentFields(intentId)
      const status = Number(fields.status)
      const currentPrice = status === INTENT_BRIDGE.STATUS.OPEN
        ? computeSuiAuctionPrice(fields, nowMs).toString()
        : null

      orders.push({
        orderId:          intentId,
        chain:            'sui',
        creator:          fields.creator as string,
        recipient:        Buffer.from(fields.recipient as number[]).toString('hex'),
        destinationChain: Number(fields.destination_chain),
        amount:           formatSuiMist(BigInt((fields.locked_balance as { value: string }).value)),
        amountRaw:        (fields.locked_balance as { value: string }).value,
        startPrice:       fields.start_price as string,
        floorPrice:       fields.floor_price as string,
        currentPrice,
        deadline:         Number(fields.deadline),
        createdAt:        Number(fields.created_at),
        status:           statusLabel(status),
        explorerUrl:      `https://suiexplorer.com/object/${intentId}?network=testnet`,
      })
    } catch {
      // skip intents that can't be fetched
    }
  }

  return orders
}

function formatSuiMist(mist: bigint): string {
  return (Number(mist) / 1e9).toFixed(6)
}

// ============================================================================
// EVM — read order state
// ============================================================================

async function listEvmOrders(
  evmChain: 'evm-fuji' | 'evm-base',
  creator: string
): Promise<IntentOrder[]> {
  const client   = evmChain === 'evm-fuji' ? getFujiClient() : getBaseClient()
  const contract = evmChain === 'evm-fuji'
    ? config.intent.evm.fuji.contract
    : config.intent.evm.baseSepolia.contract

  // Base Sepolia & Fuji public RPCs limit getLogs to 10,000 block ranges.
  // We scan backwards in 10k-block windows (up to 5 windows = ~50k blocks ≈ 40 days)
  // until we find logs or exhaust the search window.
  const WINDOW   = 9_999n
  const MAX_WINDOWS = 5

  const latestBlock = await client.getBlockNumber()
  type LogEntry = Awaited<ReturnType<typeof client.getLogs>>[number]
  const allLogs: LogEntry[] = []

  let done = false
  for (let i = 0; i < MAX_WINDOWS && !done; i++) {
    const toBlock   = latestBlock - BigInt(i) * WINDOW
    const fromBlock = toBlock > WINDOW ? toBlock - WINDOW : 0n

    try {
      const chunk = await client.getLogs({
        address: contract,
        event: INTENT_BRIDGE_ABI[3], // OrderCreated event
        args: { creator: creator as `0x${string}` },
        fromBlock,
        toBlock,
      })
      allLogs.push(...chunk)

      // Stop early once we've found orders and scanned at least 2 windows —
      // avoids unnecessary scanning when user has recent orders.
      if (allLogs.length > 0 && i >= 1) done = true
    } catch (err) {
      logger.warn({ evmChain, window: i, err }, 'getLogs chunk failed, skipping window')
    }

    if (fromBlock === 0n) done = true
  }

  const logs = allLogs as unknown as Array<{ args: { orderId: `0x${string}`; creator: `0x${string}` }; transactionHash: `0x${string}` | null }>

  const orders: IntentOrder[] = []

  for (const log of logs) {
    const orderId = log.args.orderId

    try {
      // Read full order state
      const order = await client.readContract({
        address: contract,
        abi: INTENT_BRIDGE_ABI,
        functionName: 'orders',
        args: [orderId],
      }) as readonly [string, `0x${string}`, number, bigint, bigint, bigint, bigint, bigint, number]

      const [, recipient, destChain, amount, startPrice, floorPrice, deadline, createdAt, status] = order
      const nowSec = BigInt(Math.floor(Date.now() / 1000))
      const isOpen = status === INTENT_BRIDGE.STATUS.OPEN

      let currentPrice: string | null = null
      if (isOpen) {
        try {
          const price = await client.readContract({
            address: contract,
            abi: INTENT_BRIDGE_ABI,
            functionName: 'getAuctionPrice',
            args: [orderId],
          }) as bigint
          currentPrice = price.toString()
        } catch { /* expired */ }
      }

      orders.push({
        orderId,
        chain:            evmChain,
        creator,
        recipient:        recipient.replace('0x', ''),
        destinationChain: destChain,
        amount:           formatEther(amount),
        amountRaw:        amount.toString(),
        startPrice:       startPrice.toString(),
        floorPrice:       floorPrice.toString(),
        currentPrice,
        deadline:         Number(deadline) * 1000,
        createdAt:        Number(createdAt) * 1000,
        status:           statusLabel(status),
        explorerUrl:      evmExplorerTx(evmChain, log.transactionHash ?? ''),
      })
    } catch {
      // skip
    }
  }

  return orders
}

// ============================================================================
// Solana — read intent state
// ============================================================================

// Anchor discriminator for Intent account (sha256("account:Intent")[0..8])
// Pre-computed: anchor.utils.sha256.hash("account:Intent").slice(0, 8)
const INTENT_DISCRIMINATOR = anchor.utils.sha256.hash('account:Intent').slice(0, 8)

/**
 * Layout of the Solana Intent account (after 8-byte discriminator):
 *   [0..32]   intent_id   [u8; 32]
 *   [32..64]  creator     Pubkey
 *   [64..96]  recipient   [u8; 32]
 *   [96..98]  destination_chain  u16 (LE)
 *   [98..106] amount      u64 (LE)
 *   [106..114] start_price u64 (LE)
 *   [114..122] floor_price u64 (LE)
 *   [122..130] deadline   i64 (LE)
 *   [130..138] created_at i64 (LE)
 *   [138]     status      u8
 *   [139]     bump        u8
 */
function parseSolanaIntent(
  pubkey: PublicKey,
  data: Buffer
): IntentOrder | null {
  try {
    // Skip 8-byte discriminator
    const d = data.subarray(8)
    if (d.length < 140) return null

    const intentId   = Buffer.from(d.subarray(0, 32)).toString('hex')
    const creator    = new PublicKey(d.subarray(32, 64)).toBase58()
    const recipient  = Buffer.from(d.subarray(64, 96)).toString('hex')
    const destChain  = d.readUInt16LE(96)
    const amount     = d.readBigUInt64LE(98)
    const startPrice = d.readBigUInt64LE(106)
    const floorPrice = d.readBigUInt64LE(114)
    const deadline   = d.readBigInt64LE(122)
    const createdAt  = d.readBigInt64LE(130)
    const status     = d[138]

    const nowSec = BigInt(Math.floor(Date.now() / 1000))
    let currentPrice: string | null = null
    if (status === INTENT_BRIDGE.STATUS.OPEN && nowSec < deadline) {
      const elapsed       = nowSec - createdAt
      const totalDuration = deadline - createdAt
      const priceRange    = startPrice - floorPrice
      if (totalDuration > 0n) {
        const decay = (priceRange * elapsed) / totalDuration
        currentPrice = (startPrice - decay).toString()
      } else {
        currentPrice = floorPrice.toString()
      }
    }

    let statusLabel: 'OPEN' | 'FULFILLED' | 'CANCELLED' = 'CANCELLED'
    if (status === INTENT_BRIDGE.STATUS.OPEN) statusLabel = 'OPEN'
    else if (status === INTENT_BRIDGE.STATUS.FULFILLED) statusLabel = 'FULFILLED'

    return {
      orderId:          '0x' + intentId,
      chain:            'solana',
      creator,
      recipient,
      destinationChain: destChain,
      amount:           (Number(amount) / LAMPORTS_PER_SOL).toFixed(9),
      amountRaw:        amount.toString(),
      startPrice:       startPrice.toString(),
      floorPrice:       floorPrice.toString(),
      currentPrice,
      deadline:         Number(deadline) * 1000,
      createdAt:        Number(createdAt) * 1000,
      status:           statusLabel,
      explorerUrl:      `https://explorer.solana.com/address/${pubkey.toBase58()}?cluster=devnet`,
    }
  } catch {
    return null
  }
}

/**
 * List all Solana intent accounts for a given creator address
 * using getProgramAccounts with a memcmp filter on the creator field (offset 40).
 */
async function listSolanaOrders(creator: string): Promise<IntentOrder[]> {
  const connection = getSolanaConnection()
  const programId  = new PublicKey(config.intent.solana.programId)

  let creatorPubkey: PublicKey
  try {
    creatorPubkey = new PublicKey(creator)
  } catch {
    throw new AppError('Invalid Solana address', 400, ERROR_CODES.INVALID_ADDRESS)
  }

  // Filter: discriminator at offset 0, creator at offset 8+32=40
  const accounts = await connection.getProgramAccounts(programId, {
    filters: [
      {
        memcmp: {
          offset: 0,
          bytes: anchor.utils.bytes.bs58.encode(
            Buffer.from(INTENT_DISCRIMINATOR, 'hex')
          ),
        },
      },
      {
        memcmp: {
          offset: 40, // 8 discriminator + 32 intent_id
          bytes: creatorPubkey.toBase58(),
        },
      },
    ],
  })

  const orders: IntentOrder[] = []
  for (const { pubkey, account } of accounts) {
    const order = parseSolanaIntent(pubkey, account.data as Buffer)
    if (order) orders.push(order)
  }
  return orders
}

// ============================================================================
// Public API
// ============================================================================

/**
 * GET /intent/quote
 * Returns auction parameters and estimated receive for a given intent.
 */
export async function getIntentQuote(params: {
  fromChain: SupportedChain
  toChain: SupportedChain
  token: string
  amount: string // human-readable, e.g. "1.0"
}): Promise<IntentQuote> {
  const { fromChain, toChain, token, amount } = params

  // Convert amount to source raw units
  let amountRaw: bigint
  if (fromChain === 'sui') {
    amountRaw = BigInt(Math.round(parseFloat(amount) * 1e9))
  } else if (fromChain === 'solana') {
    amountRaw = BigInt(Math.round(parseFloat(amount) * LAMPORTS_PER_SOL))
  } else {
    // EVM — ETH with 18 decimals
    amountRaw = parseEther(amount)
  }

  // Fetch FX rate to compute estimated receive in destination token units
  const amountInNum = parseFloat(amount)
  let receiveAmountNum = amountInNum

  try {
    const price = await getCrossChainPrice({ fromChain, toChain })
    receiveAmountNum = amountInNum * price.rate
  } catch {
    // Fallback: express in source token units (1:1 — better than a garbage number)
    receiveAmountNum = amountInNum
  }

  const estimatedReceive = receiveAmountNum.toFixed(6)

  // Convert receive amount to destination raw units
  let startPriceRaw: bigint
  if (toChain === 'sui') {
    startPriceRaw = BigInt(Math.round(receiveAmountNum * 1e9))
  } else if (toChain === 'solana') {
    startPriceRaw = BigInt(Math.round(receiveAmountNum * LAMPORTS_PER_SOL))
  } else {
    // EVM 18 decimals
    startPriceRaw = parseEther(receiveAmountNum.toFixed(18))
  }

  const durationMs    = INTENT_BRIDGE.AUCTION.DEFAULT_DURATION_MS
  const floorRatio    = INTENT_BRIDGE.AUCTION.DEFAULT_FLOOR_RATIO
  const floorPriceRaw = BigInt(Math.floor(Number(startPriceRaw) * floorRatio))

  return {
    fromChain,
    toChain,
    token,
    amountIn:             amount,
    amountInRaw:          amountRaw.toString(),
    currentAuctionPrice:  startPriceRaw.toString(),
    estimatedReceive,
    floorPrice:           floorPriceRaw.toString(),
    durationMs,
    wormholeFromChainId:  wormholeChainId(fromChain),
    wormholeToChainId:    wormholeChainId(toChain),
  }
}

/**
 * GET /intent/orders
 * Returns all orders for a user on a given chain (or all chains).
 */
export async function getIntentOrders(params: {
  chain?: SupportedChain
  user: string
}): Promise<IntentOrder[]> {
  const { chain, user } = params
  const results: IntentOrder[] = []

  const chains: SupportedChain[] = chain
    ? [chain]
    : ['sui', 'evm-fuji', 'evm-base', 'solana']

  const isEvmAddress     = /^0x[0-9a-fA-F]{40}$/.test(user)
  const isSolanaAddress  = !isEvmAddress && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(user)

  await Promise.allSettled(
    chains.map(async (c) => {
      try {
        if (c === 'sui') {
          results.push(...await listSuiOrders(user))
        } else if (c === 'evm-fuji' || c === 'evm-base') {
          if (!isEvmAddress) return
          results.push(...await listEvmOrders(c, user))
        } else if (c === 'solana') {
          if (!isSolanaAddress) return
          results.push(...await listSolanaOrders(user))
        }
      } catch (err) {
        logger.warn({ chain: c, user, err }, 'Failed to fetch orders for chain')
      }
    })
  )

  // Sort by createdAt descending
  return results.sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * GET /intent/price
 * Returns current estimated FX rate between two chains (token prices via CoinGecko).
 * Uses simple on-chain market data for now; returns a best-effort rate.
 */
export async function getCrossChainPrice(params: {
  fromChain: SupportedChain
  toChain: SupportedChain
}): Promise<CrossChainPrice> {
  const { fromChain, toChain } = params

  const tokenMap: Record<SupportedChain, string> = {
    'sui':      'sui',
    'evm-fuji': 'avalanche-2',
    'evm-base': 'ethereum',
    'solana':   'solana',
  }

  const fromToken = tokenMap[fromChain]
  const toToken   = tokenMap[toChain]

  // Fetch USD prices from CoinGecko (no key required for basic endpoint)
  const ids = [...new Set([fromToken, toToken])].join(',')
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`

  try {
    const res    = await fetch(url, { signal: AbortSignal.timeout(5000) })
    const data   = await res.json() as Record<string, { usd: number }>
    const fromUsd = data[fromToken]?.usd ?? 1
    const toUsd   = data[toToken]?.usd ?? 1
    const rate    = toUsd > 0 ? fromUsd / toUsd : 0

    return {
      fromChain,
      toChain,
      rate,
      fromToken,
      toToken,
      source:    'coingecko',
      updatedAt: new Date().toISOString(),
    }
  } catch {
    logger.warn({ fromChain, toChain }, 'CoinGecko price fetch failed, returning 1:1')
    return {
      fromChain,
      toChain,
      rate:      1,
      fromToken,
      toToken,
      source:    'fallback',
      updatedAt: new Date().toISOString(),
    }
  }
}

/**
 * POST /intent/build-tx
 * Constructs an unsigned transaction for the user to sign in their wallet.
 *
 * Supported actions:
 *   - "create_intent" (Sui): lock SUI to bridge to EVM
 *   - "create_order"  (EVM): lock ETH to bridge to Sui/Solana
 */
export async function buildIntentTx(params: {
  chain: SupportedChain
  action: 'create_intent' | 'create_order'
  senderAddress: string
  recipientAddress: string         // destination address (hex for EVM, base58 for Solana, hex for Sui)
  destinationChain: SupportedChain
  amount: string                   // human-readable
  startPrice?: string              // optional override
  floorPrice?: string              // optional override
  durationSeconds?: number
  withStake?: boolean
}): Promise<BuildTxResult> {
  let {
    chain,
    action,
    senderAddress,
    recipientAddress,
    destinationChain,
    amount,
    startPrice,
    floorPrice,
    durationSeconds = INTENT_BRIDGE.AUCTION.DEFAULT_DURATION_MS / 1000,
    withStake = false,
  } = params

  // If startPrice or floorPrice are missing, calculate them properly via getIntentQuote!
  if (!startPrice || !floorPrice) {
    try {
      // Pass a dummy token name, we just need the cross-chain calculation
      const quote = await getIntentQuote({
        fromChain: chain,
        toChain: destinationChain,
        token: 'TOKEN',
        amount
      });
      startPrice = startPrice || quote.currentAuctionPrice || undefined;
      floorPrice = floorPrice || quote.floorPrice || undefined;
    } catch (err) {
      logger.warn(`Failed to fetch quote for buildTx: ${err}`);
    }
  }

  if (chain === 'sui' && action === 'create_intent') {
    return buildSuiCreateIntent({
      senderAddress,
      recipientAddress,
      destinationChain,
      amount,
      durationSeconds,
      startPrice,
      floorPrice,
    })
  }

  if ((chain === 'evm-fuji' || chain === 'evm-base') && action === 'create_order') {
    return buildEvmCreateOrder({
      chain: chain as 'evm-fuji' | 'evm-base',
      recipientAddress,
      destinationChain,
      amount,
      durationSeconds,
      startPrice,
      floorPrice,
      withStake,
    })
  }

  if (chain === 'solana' && action === 'create_intent') {
    return buildSolanaCreateIntent({
      senderAddress,
      recipientAddress,
      destinationChain,
      amount,
      durationSeconds,
      startPrice,
      floorPrice,
    })
  }

  throw new AppError('Unsupported chain or action', 400, ERROR_CODES.UNSUPPORTED_CHAIN)
}

// ─── Sui: build create_intent transaction ────────────────────────────────────

async function buildSuiCreateIntent(params: {
  senderAddress: string
  recipientAddress: string
  destinationChain: SupportedChain
  amount: string
  durationSeconds: number
  startPrice?: string
  floorPrice?: string
}): Promise<BuildTxResult> {
  const { senderAddress, recipientAddress, destinationChain, amount, durationSeconds, startPrice, floorPrice } = params

  const client     = getSuiClient()
  const amountMist = BigInt(Math.round(parseFloat(amount) * 1e9))
  const destChainId = wormholeChainId(destinationChain)

  if (!startPrice || !floorPrice) {
    throw new AppError('startPrice and floorPrice are required', 400, ERROR_CODES.VALIDATION_ERROR)
  }

  const startPriceMist = BigInt(startPrice)
  const floorPriceMist = BigInt(floorPrice)
  const durationMs = durationSeconds * 1000

  // Encode recipient as bytes (EVM address → 20-byte hex, Solana → 32-byte base58 decoded)
  let recipientBytes: number[]
  if (recipientAddress.startsWith('0x')) {
    // EVM address: pad to 20 bytes
    const hex = recipientAddress.slice(2).padStart(40, '0')
    recipientBytes = Array.from(Buffer.from(hex, 'hex'))
  } else {
    // Solana: base58-decode to 32 bytes
    try {
      const pubkey = new PublicKey(recipientAddress)
      recipientBytes = Array.from(pubkey.toBytes())
    } catch {
      throw new AppError('Invalid recipient address for Solana destination', 400, ERROR_CODES.INVALID_ADDRESS)
    }
  }

  const tx = new Transaction()

  // Split coin for the locked amount
  const [coin] = tx.splitCoins(tx.gas, [amountMist])

  // Fetch clock object ID (0x6 is the system clock on Sui)
  tx.moveCall({
    target: `${config.intent.sui.packageId}::intent_bridge::create_intent`,
    arguments: [
      coin,
      tx.pure.vector('u8', recipientBytes),
      tx.pure.u16(destChainId),
      tx.pure.u64(startPriceMist),
      tx.pure.u64(floorPriceMist),
      tx.pure.u64(durationMs),
      tx.object('0x6'), // Sui clock object
    ],
  })

  tx.setSender(senderAddress)

  // Build unsigned tx bytes
  const txBytes = await tx.build({ client })
  const txBytesB64 = Buffer.from(txBytes).toString('base64')

  return {
    chain: 'sui',
    tx: {
      txBytes: txBytesB64,
      description: `Create Sui intent: lock ${amount} SUI → bridge to ${destinationChain} (${durationSeconds}s Dutch auction)`,
    },
  }
}

// ─── EVM: build createOrder calldata ─────────────────────────────────────────

async function buildEvmCreateOrder(params: {
  chain: 'evm-fuji' | 'evm-base'
  recipientAddress: string
  destinationChain: SupportedChain
  amount: string
  durationSeconds: number
  startPrice?: string
  floorPrice?: string
  withStake?: boolean
}): Promise<BuildTxResult> {
  const { chain, recipientAddress, destinationChain, amount, durationSeconds, startPrice, floorPrice, withStake = false } = params

  const contract    = chain === 'evm-fuji'
    ? config.intent.evm.fuji.contract
    : config.intent.evm.baseSepolia.contract
  const chainId     = chain === 'evm-fuji'
    ? config.intent.evm.fuji.chainId
    : config.intent.evm.baseSepolia.chainId
  const amountWei   = parseEther(amount)
  const destChainId = wormholeChainId(destinationChain)

  if (!startPrice || !floorPrice) {
    throw new AppError('startPrice and floorPrice are required', 400, ERROR_CODES.VALIDATION_ERROR)
  }

  const startPriceWei = BigInt(startPrice)
  const floorPriceWei = BigInt(floorPrice)

  // Encode recipient as bytes32
  let recipientBytes32: `0x${string}`
  if (recipientAddress.startsWith('0x')) {
    // EVM address: pad to 32 bytes
    recipientBytes32 = `0x${recipientAddress.slice(2).padStart(64, '0')}` as `0x${string}`
  } else {
    // Solana / Sui: treat as base58 public key → 32 bytes
    try {
      const pubkey = new PublicKey(recipientAddress)
      recipientBytes32 = `0x${Buffer.from(pubkey.toBytes()).toString('hex')}` as `0x${string}`
    } catch {
      throw new AppError('Invalid recipient address', 400, ERROR_CODES.INVALID_ADDRESS)
    }
  }

  const data = encodeFunctionData({
    abi: INTENT_BRIDGE_ABI,
    functionName: 'createOrder',
    args: [
      recipientBytes32,
      destChainId,
      startPriceWei,
      floorPriceWei,
      BigInt(durationSeconds),
      withStake,
    ],
  })

  return {
    chain: 'evm',
    tx: {
      to:          contract,
      data,
      value:       amountWei.toString(),
      chainId,
      description: `Create EVM order: lock ${amount} ETH → bridge to ${destinationChain} (${durationSeconds}s Dutch auction)${withStake ? ' + liquid stake' : ''}`,
    },
  }
}

// ─── Solana: build create_intent transaction (Anchor, devnet) ─────────────────

async function buildSolanaCreateIntent(params: {
  senderAddress: string
  recipientAddress: string
  destinationChain: SupportedChain
  amount: string
  durationSeconds: number
  startPrice?: string
  floorPrice?: string
}): Promise<BuildTxResult> {
  const { senderAddress, recipientAddress, destinationChain, amount, durationSeconds, startPrice, floorPrice } = params

  const connection   = getSolanaConnection()
  const programId    = new PublicKey(config.intent.solana.programId)
  const creatorKey   = new PublicKey(senderAddress)
  const amountLamports = BigInt(Math.round(parseFloat(amount) * LAMPORTS_PER_SOL))
  const destChainId  = wormholeChainId(destinationChain)

  if (!startPrice || !floorPrice) {
    throw new AppError('startPrice and floorPrice are required', 400, ERROR_CODES.VALIDATION_ERROR)
  }

  const startPriceLamports = BigInt(startPrice)
  const floorPriceLamports = BigInt(floorPrice)

  // Encode recipient bytes (EVM → 20 bytes zero-padded to 32, Sui/unknown → 32-byte hex)
  let recipientBytes: Uint8Array
  if (recipientAddress.startsWith('0x')) {
    const buf = Buffer.alloc(32)
    const hex = recipientAddress.slice(2).padStart(40, '0').slice(0, 40)
    Buffer.from(hex, 'hex').copy(buf, 12) // right-aligned, EVM style
    recipientBytes = buf
  } else {
    // Solana base58 pubkey → 32 bytes
    try {
      recipientBytes = new PublicKey(recipientAddress).toBytes()
    } catch {
      throw new AppError('Invalid recipient address for Solana build-tx', 400, ERROR_CODES.INVALID_ADDRESS)
    }
  }

  // Generate a random intent_id (32 bytes)
  const intentId = new Uint8Array(32)
  crypto.getRandomValues(intentId)

  // Derive the Intent PDA: seeds = [b"intent", intent_id]
  const INTENT_SEED = Buffer.from('intent')
  const [intentPda] = PublicKey.findProgramAddressSync(
    [INTENT_SEED, intentId],
    programId
  )

  // Build the Anchor instruction discriminator for create_intent
  // Anchor discriminator = sha256("global:create_intent")[0..8]
  const ixDiscriminator = Buffer.from(
    anchor.utils.sha256.hash('global:create_intent').slice(0, 8),
    'hex'
  )

  // Encode args using Borsh (manual, matching the Anchor IDL layout)
  // create_intent(intent_id: [u8;32], recipient: [u8;32], destination_chain: u16,
  //               start_price: u64, floor_price: u64, duration_seconds: u64)
  const argsBuffer = Buffer.alloc(32 + 32 + 2 + 8 + 8 + 8) // 90 bytes
  let offset = 0

  Buffer.from(intentId).copy(argsBuffer, offset); offset += 32
  Buffer.from(recipientBytes).copy(argsBuffer, offset); offset += 32
  argsBuffer.writeUInt16LE(destChainId, offset); offset += 2
  argsBuffer.writeBigUInt64LE(startPriceLamports, offset); offset += 8
  argsBuffer.writeBigUInt64LE(floorPriceLamports, offset); offset += 8
  argsBuffer.writeBigUInt64LE(BigInt(durationSeconds), offset)

  const ixData = Buffer.concat([ixDiscriminator, argsBuffer])

  // Fetch recent blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()

  // Build the instruction
  // Accounts: creator, payment (same as creator — SOL transfer), intent PDA, system_program
  const { TransactionInstruction } = await import('@solana/web3.js')
  const instruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: creatorKey,              isSigner: true,  isWritable: true  }, // creator
      { pubkey: creatorKey,              isSigner: false, isWritable: true  }, // payment (same)
      { pubkey: intentPda,               isSigner: false, isWritable: true  }, // intent PDA
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    ],
    data: ixData,
  })

  // Build VersionedTransaction (v0 message)
  const message = new TransactionMessage({
    payerKey: creatorKey,
    recentBlockhash: blockhash,
    instructions: [instruction],
  }).compileToV0Message()

  const vtx = new VersionedTransaction(message)
  const txBase64 = Buffer.from(vtx.serialize()).toString('base64')

  return {
    chain: 'solana',
    tx: {
      txBase64,
      description: `Create Solana intent: lock ${amount} SOL → bridge to ${destinationChain} (${durationSeconds}s Dutch auction). Intent PDA: ${intentPda.toBase58()}`,
    },
  }
}

// ─── EVM balance check ───────────────────────────────────────────────────────

/**
 * Get native ETH balance of an EVM address on a given chain.
 * Returns balanceWei (string) and balanceEth (string).
 */
export async function getEvmNativeBalance(params: {
  chain: 'evm-fuji' | 'evm-base'
  address: string
}): Promise<{ chain: string; address: string; balanceWei: string; balanceEth: string }> {
  const { chain, address } = params
  const client = chain === 'evm-fuji' ? getFujiClient() : getBaseClient()

  const balanceWei = await client.getBalance({ address: address as `0x${string}` })

  return {
    chain,
    address,
    balanceWei: balanceWei.toString(),
    balanceEth: formatEther(balanceWei),
  }
}
