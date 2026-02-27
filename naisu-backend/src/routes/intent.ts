/**
 * Intent Bridge Routes
 * REST API endpoints for the intent-bridge Dutch auction protocol:
 *
 *   GET  /api/v1/intent/quote?fromChain=...&toChain=...&token=...&amount=...
 *   GET  /api/v1/intent/orders?user=...&chain=...
 *   GET  /api/v1/intent/price?fromChain=...&toChain=...
 *   POST /api/v1/intent/build-tx
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as intentService from '@services/intent.service'
import type { SupportedChain } from '@services/intent.service'
import { getOrdersByCreator, getIndexerStatus, indexerEvents } from '@services/indexer'
import type { OrderUpdateEvent } from '@services/indexer'
import { rateLimit } from '@middleware/rate-limit'
import { logger } from '@lib/logger'

export const intentRouter = new Hono()

intentRouter.use('*', rateLimit({ windowMs: 60000, maxRequests: 200 }))

// ============================================================================
// GET /watch  — Server-Sent Events: stream order status changes for a user
// ============================================================================

/**
 * SSE stream that watches a user's intent orders and pushes events whenever
 * an order transitions to FULFILLED, CANCELLED, or EXPIRED.
 *
 * Events emitted:
 *   event: order_update
 *   data: { orderId, status, chain, amount, explorerUrl, toChain }
 *
 * Usage:
 *   const es = new EventSource('/api/v1/intent/watch?user=0xABC&chain=evm-base')
 *   es.addEventListener('order_update', e => console.log(JSON.parse(e.data)))
 */
intentRouter.get('/watch', async (c) => {
  const user  = c.req.query('user')
  const chain = c.req.query('chain') as SupportedChain | undefined

  if (!user) {
    return c.json({ success: false, error: 'user query param required' }, 400)
  }

  const userLower = user.toLowerCase()
  let closed = false

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()

      const send = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch { closed = true }
      }

      // Send current snapshot of user's orders immediately on connect
      const snapshot = getOrdersByCreator(user, chain)
      send('snapshot', { orders: snapshot })
      send('ping', { t: Date.now() })

      // Subscribe to indexer events — only forward events for this user
      const onUpdate = (order: ReturnType<typeof getOrdersByCreator>[number]) => {
        if (order.creator.toLowerCase() !== userLower) return
        if (chain && order.chain !== chain) return

        const now = Date.now()
        const isExpired = order.status === 'OPEN' && order.deadline < now
        const effectiveStatus = isExpired ? 'EXPIRED' : order.status

        // Only push terminal status changes
        if (effectiveStatus === 'FULFILLED' || effectiveStatus === 'CANCELLED' || effectiveStatus === 'EXPIRED') {
          const payload: OrderUpdateEvent = {
            orderId:          order.orderId,
            status:           effectiveStatus,
            prevStatus:       'OPEN',
            chain:            order.chain,
            amount:           order.amount,
            explorerUrl:      order.explorerUrl,
            destinationChain: order.destinationChain,
          }
          send('order_update', payload)
        }
      }

      indexerEvents.on('order_update', onUpdate)

      // Heartbeat every 30s to keep connection alive through proxies
      const heartbeat = setInterval(() => send('ping', { t: Date.now() }), 30_000)

      // Auto-close after 10 min — client reconnects
      const autoClose = setTimeout(() => {
        send('close', { reason: 'timeout' })
        cleanup()
        controller.close()
      }, 10 * 60_000)

      const cleanup = () => {
        closed = true
        clearInterval(heartbeat)
        clearTimeout(autoClose)
        indexerEvents.off('order_update', onUpdate)
      }

      // Store cleanup on the controller cancel
      ;(controller as unknown as { _cleanup?: () => void })._cleanup = cleanup
    },
    cancel() {
      closed = true
      // cleanup is called via the stored reference
      const ctrl = this as unknown as { _cleanup?: () => void }
      ctrl._cleanup?.()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
})

// ============================================================================
// Validators
// ============================================================================

const chainEnum = z.enum(['sui', 'evm-fuji', 'evm-base', 'solana'])

const quoteQuery = z.object({
  fromChain: chainEnum,
  toChain:   chainEnum,
  token:     z.string().min(1).default('native'),
  amount:    z
    .string()
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0, {
      message: 'amount must be a positive number string (e.g. "1.5")',
    }),
})

const ordersQuery = z.object({
  user:  z.string().min(1),
  chain: chainEnum.optional(),
})

const priceQuery = z.object({
  fromChain: chainEnum,
  toChain:   chainEnum,
})

const buildTxBody = z.object({
  chain:            chainEnum,
  action:           z.enum(['create_intent', 'create_order']),
  senderAddress:    z.string().min(1),
  recipientAddress: z.string().min(1),
  destinationChain: chainEnum,
  amount:           z
    .string()
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0, {
      message: 'amount must be a positive number string',
    }),
  startPrice:      z.string().optional(),
  floorPrice:      z.string().optional(),
  durationSeconds: z.number().int().positive().max(86400).optional(),
})

// ============================================================================
// GET /quote
// ============================================================================

/**
 * Returns auction price parameters for a cross-chain intent.
 * Does NOT create any on-chain transaction.
 *
 * Example:
 *   GET /api/v1/intent/quote?fromChain=evm-fuji&toChain=sui&token=ETH&amount=0.1
 */
intentRouter.get('/quote', zValidator('query', quoteQuery), async (c) => {
  const { fromChain, toChain, token, amount } = c.req.valid('query')

  logger.info({ fromChain, toChain, token, amount }, 'Intent quote requested')

  const quote = await intentService.getIntentQuote({
    fromChain: fromChain as SupportedChain,
    toChain:   toChain   as SupportedChain,
    token,
    amount,
  })

  return c.json({ success: true, data: quote })
})

// ============================================================================
// GET /orders
// ============================================================================

/**
 * Returns all intent orders for a wallet address (optionally filtered by chain).
 *
 * Example:
 *   GET /api/v1/intent/orders?user=0xabc...&chain=evm-fuji
 *   GET /api/v1/intent/orders?user=0xdF3...  (all chains)
 */
intentRouter.get('/orders', zValidator('query', ordersQuery), async (c) => {
  const { user, chain } = c.req.valid('query')

  logger.info({ user, chain }, 'Intent orders requested')

  // Primary: read from in-memory indexer store (instant, no RPC)
  const indexed = getOrdersByCreator(user, chain as SupportedChain | undefined)

  if (indexed.length > 0) {
    return c.json({ success: true, data: indexed, total: indexed.length, source: 'indexer' })
  }

  // Fallback: query RPC directly if indexer hasn't seen this user yet
  // (e.g. indexer just started or user has very old orders)
  logger.info({ user, chain }, 'Indexer miss — falling back to direct RPC query')
  const orders = await intentService.getIntentOrders({
    user,
    chain: chain as SupportedChain | undefined,
  })

  return c.json({ success: true, data: orders, total: orders.length, source: 'rpc' })
})

// ============================================================================
// GET /price
// ============================================================================

/**
 * Returns estimated FX rate between two chain tokens (via CoinGecko).
 *
 * Example:
 *   GET /api/v1/intent/price?fromChain=evm-fuji&toChain=sui
 */
intentRouter.get('/price', zValidator('query', priceQuery), async (c) => {
  const { fromChain, toChain } = c.req.valid('query')

  logger.info({ fromChain, toChain }, 'Cross-chain price requested')

  const price = await intentService.getCrossChainPrice({
    fromChain: fromChain as SupportedChain,
    toChain:   toChain   as SupportedChain,
  })

  return c.json({ success: true, data: price })
})

// ============================================================================
// POST /build-tx
// ============================================================================

/**
 * Constructs an unsigned transaction for the user to sign in their wallet.
 * The backend does NOT sign or broadcast anything.
 *
 * For Sui:  returns { chain: "sui",  tx: { txBytes: "<base64>", description } }
 * For EVM:  returns { chain: "evm",  tx: { to, data, value, chainId, description } }
 *
 * Example body:
 * {
 *   "chain": "evm-fuji",
 *   "action": "create_order",
 *   "senderAddress": "0xYourAddress",
 *   "recipientAddress": "0xDestinationOrSuiAddress",
 *   "destinationChain": "sui",
 *   "amount": "0.05"
 * }
 */
// GET /indexer/status — debug endpoint
intentRouter.get('/indexer/status', (c) => {
  return c.json({ success: true, data: getIndexerStatus() })
})

intentRouter.post('/build-tx', zValidator('json', buildTxBody), async (c) => {
  const body = c.req.valid('json')

  logger.info(
    { chain: body.chain, action: body.action, amount: body.amount },
    'Build intent tx requested'
  )

  const result = await intentService.buildIntentTx({
    chain:            body.chain as SupportedChain,
    action:           body.action,
    senderAddress:    body.senderAddress,
    recipientAddress: body.recipientAddress,
    destinationChain: body.destinationChain as SupportedChain,
    amount:           body.amount,
    startPrice:       body.startPrice,
    floorPrice:       body.floorPrice,
    durationSeconds:  body.durationSeconds,
  })

  return c.json({ success: true, data: result })
})
