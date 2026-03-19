/**
 * Intent Bridge Routes
 * REST API endpoints for the intent-bridge Dutch auction protocol:
 *
 *   GET  /api/v1/intent/quote?fromChain=...&toChain=...&token=...&amount=...
 *   GET  /api/v1/intent/orders?user=...&chain=...
 *   GET  /api/v1/intent/price?fromChain=...&toChain=...
 *   POST /api/v1/intent/build-tx
 *   POST /api/v1/intent/submit-signature (NEW - Gasless)
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as intentService from '@services/intent.service'
import type { SupportedChain } from '@services/intent.service'
import { getOrdersByCreator, getIndexerStatus, indexerEvents, injectGaslessOrder } from '@services/indexer'
import { getActiveSolverCount, solverEvents } from '@services/solver.service'
import type { SolverProgressEvent } from '@services/solver.service'
import type { OrderUpdateEvent } from '@services/indexer'
import { rateLimit } from '@middleware/rate-limit'
import { logger } from '@lib/logger'
import { verifyIntentSignature } from '@lib/signature-verifier'
import { addIntent, updateIntentStatus, getOrderbookStats, getUserNonce } from '@services/intent-orderbook.service'
import { formatEther } from 'viem'
import type { Hex, Address } from 'viem'

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
          const payload: OrderUpdateEvent & { startPrice?: string } = {
            orderId:          order.orderId,
            status:           effectiveStatus,
            prevStatus:       'OPEN',
            chain:            order.chain,
            amount:           order.amount,
            explorerUrl:      order.explorerUrl,
            destinationChain: order.destinationChain,
            startPrice:       order.startPrice,
          }
          send('order_update', payload)
        }
      }

      // Push order_created so frontend refreshes immediately when a new order is indexed
      const onCreated = (order: ReturnType<typeof getOrdersByCreator>[number]) => {
        if (order.creator.toLowerCase() !== userLower) return
        if (chain && order.chain !== chain) return
        send('order_created', { orderId: order.orderId, chain: order.chain })
      }

      indexerEvents.on('order_update', onUpdate)
      indexerEvents.on('order_created', onCreated)

      // Subscribe to solver pipeline events — forward all (not user-scoped, orderId on client)
      const onSolverEvent = (evt: SolverProgressEvent) => {
        send(evt.type, { orderId: evt.orderId, ...evt.data })
      }
      solverEvents.on('rfq_broadcast', onSolverEvent)
      solverEvents.on('rfq_winner', onSolverEvent)
      solverEvents.on('order_fulfilled', onSolverEvent)

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
        indexerEvents.off('order_created', onCreated)
        solverEvents.off('rfq_broadcast', onSolverEvent)
        solverEvents.off('rfq_winner', onSolverEvent)
        solverEvents.off('order_fulfilled', onSolverEvent)
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

const chainEnum = z.enum(['sui', 'evm-base', 'solana'])

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
  outputToken:     z.enum(['sol', 'msol']).default('sol'),
})

// ============================================================================
// GET /quote
// ============================================================================

/**
 * Returns auction price parameters for a cross-chain intent.
 * Does NOT create any on-chain transaction.
 *
 * Example:
 *   GET /api/v1/intent/quote?fromChain=evm-base&toChain=sui&token=ETH&amount=0.1
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

  return c.json({ success: true, data: { ...quote, activeSolvers: getActiveSolverCount() } })
})

// ============================================================================
// GET /orders
// ============================================================================

/**
 * Returns all intent orders for a wallet address (optionally filtered by chain).
 *
 * Example:
 *   GET /api/v1/intent/orders?user=0xabc...&chain=evm-base
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
 *   GET /api/v1/intent/price?fromChain=evm-base&toChain=sui
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
// POST /build-gasless — Gasless Intent Parameters (EIP-712, no on-chain tx)
// ============================================================================

/**
 * Returns all parameters needed for the frontend to construct an EIP-712
 * signed intent. The user signs a message (no gas) and the winning solver
 * calls executeIntent() on-chain.
 */
const buildGaslessBody = z.object({
  senderAddress:    z.string().min(1),
  recipientAddress: z.string().min(1),
  destinationChain: z.enum(['solana', 'sui']),
  amount:           z.string().refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0, {
    message: 'amount must be a positive number string',
  }),
  durationSeconds:  z.number().int().positive().max(86400).optional(),
  outputToken:      z.enum(['sol', 'msol']).default('sol'),
})

intentRouter.post('/build-gasless', zValidator('json', buildGaslessBody), async (c) => {
  const body = c.req.valid('json')

  if (getActiveSolverCount() === 0) {
    return c.json({
      success: false,
      error: 'No solver is currently active. Please try again when a solver is online.',
    }, 503)
  }

  const toChain = body.destinationChain === 'solana' ? 'solana' : 'sui'
  const quote = await intentService.getIntentQuote({
    fromChain: 'evm-base',
    toChain:   toChain as SupportedChain,
    token:     'native',
    amount:    body.amount,
  })

  const nonce = getUserNonce(body.senderAddress as Address)
  const durationSeconds = body.durationSeconds ?? 300

  return c.json({
    success: true,
    data: {
      type:             'gasless_intent',
      recipientAddress: body.recipientAddress,
      destinationChain: body.destinationChain,
      amount:           body.amount,
      outputToken:      body.outputToken,
      startPrice:       quote.currentAuctionPrice ?? quote.floorPrice,
      floorPrice:       quote.floorPrice,
      durationSeconds,
      nonce,
    },
  })
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
 *   "chain": "evm-base",
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

  // Block order creation if no solver is available — user's funds would be stuck until deadline
  if (body.action === 'create_order' && getActiveSolverCount() === 0) {
    return c.json({
      success: false,
      error: 'No solver is currently active. Your funds would be locked until the auction deadline with no one to fill the order. Please try again when a solver is online.',
    }, 503)
  }

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
    outputToken:      body.outputToken,
  })

  return c.json({ success: true, data: result })
})

// ============================================================================
// POST /submit-signature — Gasless Intent Submission (EIP-712 Signature)
// ============================================================================

/**
 * Submit a signed intent off-chain (gasless for user).
 * Backend verifies signature, stores intent in memory, runs RFQ with solvers.
 * Winning solver will call executeIntent() on-chain with this signature.
 *
 * Request body:
 * {
 *   "intent": {
 *     "creator": "0xUserAddress",
 *     "recipient": "0x...", // bytes32 hex string
 *     "destinationChain": 1, // uint16 (1 = Solana, 21 = Sui)
 *     "amount": "1000000000000000000", // wei string
 *     "startPrice": "22000000000", // lamports string
 *     "floorPrice": "15000000000",
 *     "deadline": 1234567890, // unix timestamp
 *     "intentType": 0, // 0=SOL, 1=mSOL, 2=USDC
 *     "nonce": 0 // user's current nonce
 *   },
 *   "signature": "0xabc..." // EIP-712 signature (65 bytes hex)
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "intentId": "0x...",
 *     "status": "pending_rfq",
 *     "estimatedFillTime": 30000 // ms
 *   }
 * }
 */
const submitSignatureBody = z.object({
  intent: z.object({
    creator:          z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    recipient:        z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    destinationChain: z.number().int().positive(),
    amount:           z.string().regex(/^\d+$/),
    startPrice:       z.string().regex(/^\d+$/),
    floorPrice:       z.string().regex(/^\d+$/),
    deadline:         z.number().int().positive(),
    intentType:       z.number().int().min(0).max(2),
    nonce:            z.number().int().min(0),
  }),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/), // 65 bytes = 130 hex chars
})

intentRouter.post('/submit-signature', zValidator('json', submitSignatureBody), async (c) => {
  const body = c.req.valid('json')

  logger.info(
    { 
      creator: body.intent.creator,
      amount: body.intent.amount,
      destinationChain: body.intent.destinationChain,
      nonce: body.intent.nonce
    },
    'Gasless intent signature submitted'
  )

  // Block if no solver is available
  if (getActiveSolverCount() === 0) {
    return c.json({
      success: false,
      error: 'No solver is currently active. Your intent cannot be filled. Please try again when a solver is online.',
    }, 503)
  }

  // Validate deadline hasn't already passed
  const now = Math.floor(Date.now() / 1000)
  if (body.intent.deadline <= now) {
    return c.json({
      success: false,
      error: 'Intent deadline has already passed',
    }, 400)
  }

  // Convert string amounts to bigint for signature verification
  const intentForVerification = {
    creator: body.intent.creator as Address,
    recipient: body.intent.recipient as Hex,
    destinationChain: body.intent.destinationChain,
    amount: BigInt(body.intent.amount),
    startPrice: BigInt(body.intent.startPrice),
    floorPrice: BigInt(body.intent.floorPrice),
    deadline: BigInt(body.intent.deadline),
    intentType: body.intent.intentType,
    nonce: BigInt(body.intent.nonce),
  }

  // Verify EIP-712 signature
  const isValidSignature = await verifyIntentSignature(
    intentForVerification,
    body.signature as Hex
  )

  if (!isValidSignature) {
    logger.warn({ creator: body.intent.creator, nonce: body.intent.nonce }, 'Invalid signature')
    return c.json({
      success: false,
      error: 'Invalid signature',
    }, 400)
  }

  // Generate unique intent ID
  const intentId = `0x${Buffer.from(
    `${body.intent.creator}${body.intent.nonce}${Date.now()}`
  ).toString('hex').slice(0, 64)}`

  // Add to orderbook with proper typing
  const pendingIntent = addIntent(
    intentId,
    {
      creator: body.intent.creator as Address,
      recipient: body.intent.recipient as Hex,
      destinationChain: body.intent.destinationChain,
      amount: body.intent.amount,
      startPrice: body.intent.startPrice,
      floorPrice: body.intent.floorPrice,
      deadline: body.intent.deadline,
      intentType: body.intent.intentType,
      nonce: body.intent.nonce,
    },
    body.signature as Hex
  )

  // Update status to rfq_active (RFQ system will pick this up)
  updateIntentStatus(intentId, 'rfq_active')

  // Inject into indexer store so Active Intents widget shows it as OPEN
  injectGaslessOrder({
    intentId,
    creator:          body.intent.creator,
    recipient:        body.intent.recipient,
    destinationChain: body.intent.destinationChain,
    amount:           formatEther(BigInt(body.intent.amount)),
    amountRaw:        body.intent.amount,
    startPrice:       body.intent.startPrice,
    floorPrice:       body.intent.floorPrice,
    deadline:         body.intent.deadline,
    intentType:       body.intent.intentType,
  })

  logger.info({ intentId, creator: body.intent.creator }, 'Intent added to orderbook, starting RFQ')

  return c.json({
    success: true,
    data: {
      intentId,
      status: 'rfq_active',
      estimatedFillTime: 30000, // 30 seconds
      message: 'Intent verified and submitted. Solvers are bidding...'
    }
  })
})

// ============================================================================
// GET /orderbook/stats — Debug endpoint to view orderbook statistics
// ============================================================================

intentRouter.get('/orderbook/stats', (c) => {
  return c.json({ success: true, data: getOrderbookStats() })
})

// ============================================================================
// GET /nonce — Get expected nonce for a user address (for gasless intents)
// ============================================================================

/**
 * Returns the expected nonce for a user's next gasless intent.
 * This should be included in the EIP-712 signed message to prevent replay attacks.
 *
 * Example:
 *   GET /api/v1/intent/nonce?address=0xABC...
 */
intentRouter.get(
  '/nonce',
  zValidator('query', z.object({
    address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a valid EVM address'),
  })),
  (c) => {
    const { address } = c.req.valid('query')

    logger.info({ address }, 'Nonce requested')

    const nonce = getUserNonce(address as Address)

    return c.json({ 
      success: true, 
      data: { 
        address,
        nonce,
        message: 'Include this nonce in your next signed intent'
      } 
    })
  }
)

// ============================================================================
// GET /evm-balance — Get native ETH balance of an EVM address
// ============================================================================

/**
 * Returns native ETH balance for an EVM address on evm-base.
 *
 * Example:
 *   GET /api/v1/intent/evm-balance?chain=evm-base&address=0xABC...
 */
intentRouter.get(
  '/evm-balance',
  zValidator('query', z.object({
    chain:   z.enum(['evm-base']),
    address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a valid EVM address'),
  })),
  async (c) => {
    const { chain, address } = c.req.valid('query')

    logger.info({ chain, address }, 'EVM balance requested')

    const balance = await intentService.getEvmNativeBalance({
      chain,
      address,
    })

    return c.json({ success: true, data: balance })
  }
)
