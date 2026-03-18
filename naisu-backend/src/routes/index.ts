/**
 * API Routes
 * Hono router composition for Uniswap V4 Backend
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { prettyJSON } from 'hono/pretty-json'
import { secureHeaders } from 'hono/secure-headers'
import { requestId } from 'hono/request-id'

import { config } from '@config/env'
import { logger } from '@lib/logger'

// Middleware
import { errorHandler } from '@middleware/error-handler'
import { rateLimit } from '@middleware/rate-limit'

// Routes
import { healthRouter } from './health'
import { uniswapV4Router } from './uniswap-v4'
import { cetusRouter } from './cetus'
import { solanaRouter } from './solana'
import { intentRouter } from './intent'
import { solverRouter } from './solver'
import { docsRouter } from './docs'
import { yieldRouter } from './yield'
import { portfolioRouter } from './portfolio'

// ============================================================================
// Main App
// ============================================================================

export const app = new Hono()

const corsOrigins = config.cors.origin
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
const allowAllOrigins = corsOrigins.includes('*')

function parseOrigin(origin: string): string | null {
  try {
    return new URL(origin).origin
  } catch {
    return null
  }
}

function canonicalOrigin(origin: string): string | null {
  const parsed = parseOrigin(origin)
  if (!parsed) return null
  const url = new URL(parsed)
  if (url.hostname.startsWith('www.')) {
    url.hostname = url.hostname.slice(4)
  }
  return url.origin
}

const allowedOrigins = new Set(corsOrigins)
const allowedCanonicalOrigins = new Set(
  corsOrigins.map(canonicalOrigin).filter((origin): origin is string => Boolean(origin))
)
const hardcodedAllowedHosts = new Set(['naisu.one', 'www.naisu.one', 'naisu1-beta.vercel.app'])

// Global middleware
app.use(requestId())
app.use(secureHeaders())
app.use(
  cors({
    origin: (requestOrigin) => {
      if (allowAllOrigins) {
        // Mirror caller origin when possible (works with credentials across domains).
        return requestOrigin || '*'
      }
      if (!requestOrigin) {
        return corsOrigins[0] || ''
      }

      const parsed = parseOrigin(requestOrigin)
      const canonical = canonicalOrigin(requestOrigin)
      if (
        allowedOrigins.has(requestOrigin) ||
        (parsed !== null && allowedOrigins.has(parsed)) ||
        (canonical !== null && allowedCanonicalOrigins.has(canonical))
      ) {
        return requestOrigin
      }

      // Safety net for official frontend domains if env is missing one variant.
      if (parsed) {
        const url = new URL(parsed)
        if (url.protocol === 'https:' && hardcodedAllowedHosts.has(url.hostname)) {
          return requestOrigin
        }
      }

      // If no match, return the first allowed origin or allow all if configured
      return allowAllOrigins ? requestOrigin || '*' : corsOrigins[0] || requestOrigin || '*'
    },
    allowMethods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE', 'PATCH'],
    allowHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'X-Requested-With'],
    exposeHeaders: ['Content-Length', 'X-Request-Id'],
    credentials: true,
    maxAge: 86400,
  })
)
app.use(prettyJSON())

// Handle OPTIONS preflight requests explicitly
app.options('*', (c) => {
  return c.body(null, 204)
})

// Request logging
app.use('*', async (c, next) => {
  const start = Date.now()
  await next()
  const duration = Date.now() - start

  logger.info(
    {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration: `${duration}ms`,
      requestId: c.get('requestId'),
    },
    'Request completed'
  )
})

// Global rate limiting
app.use(
  '*',
  rateLimit({
    windowMs: 60000,
    maxRequests: 1000,
  })
)

// Error handling
app.onError(errorHandler)

// ============================================================================
// API Routes
// ============================================================================

const api = app.basePath('/api/v1')

// Health check
api.route('/health', healthRouter)

// Uniswap V4 routes
api.route('/uniswap-v4', uniswapV4Router)

// Cetus CLMM routes (Sui)
api.route('/cetus', cetusRouter)

// Solana balance
api.route('/solana', solanaRouter)

// Intent Bridge routes (cross-chain Dutch auction)
api.route('/intent', intentRouter)

// Solver network routes (registry + RFQ + selection)
api.route('/solver', solverRouter)

// Yield APY rates (Marinade, marginfi, Orca)
api.route('/yield', yieldRouter)
api.route('/portfolio', portfolioRouter)

// API Docs (mounted at root level, not under /api/v1)
app.route('/docs', docsRouter)

// 404 handler
api.notFound((c) => {
  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Route ${c.req.method} ${c.req.path} not found`,
      },
    },
    404
  )
})

// ============================================================================
// Type Exports (for Hono RPC client)
// ============================================================================

export type AppType = typeof app
