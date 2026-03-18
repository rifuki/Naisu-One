/**
 * Solver Network Routes
 *
 *   POST /api/v1/solver/register         — solver daftar saat startup
 *   POST /api/v1/solver/heartbeat        — solver ping setiap 30s (auth: Bearer token)
 *   GET  /api/v1/solver/list             — list semua solver aktif + stats
 *   GET  /api/v1/solver/selection/:orderId — hasil RFQ + winner reasoning
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import {
  registerSolver,
  processHeartbeat,
  listSolvers,
  getSolverSelection,
} from '@services/solver.service'
import { rateLimit } from '@middleware/rate-limit'
import { logger } from '@lib/logger'

export const solverRouter = new Hono()

solverRouter.use('*', rateLimit({ windowMs: 60000, maxRequests: 500 }))

// ============================================================================
// POST /register
// ============================================================================

const registerBody = z.object({
  name:            z.string().min(1).max(32),
  evmAddress:      z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid EVM address'),
  solanaAddress:   z.string().min(32).max(44),
  callbackUrl:     z.string().url(),
  supportedRoutes: z.array(z.string()).min(1),
})

solverRouter.post('/register', zValidator('json', registerBody), async (c) => {
  const body = c.req.valid('json')

  logger.info({ name: body.name, evmAddress: body.evmAddress }, '[Route] Solver register')

  const result = registerSolver(body)
  return c.json({ success: true, data: result }, 201)
})

// ============================================================================
// POST /heartbeat
// ============================================================================

const heartbeatBody = z.object({
  solanaBalance: z.string(),
  evmBalance:    z.string(),
  status:        z.enum(['ready', 'busy', 'draining']),
})

solverRouter.post('/heartbeat', zValidator('json', heartbeatBody), async (c) => {
  const authHeader = c.req.header('Authorization')
  const token      = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    return c.json({ success: false, error: 'Authorization header required' }, 401)
  }

  const body = c.req.valid('json')
  const ok   = processHeartbeat(token, body)

  if (!ok) {
    return c.json({ success: false, error: 'Invalid token' }, 401)
  }

  return c.json({ success: true })
})

// ============================================================================
// GET /list
// ============================================================================

solverRouter.get('/list', (c) => {
  const solvers = listSolvers()
  return c.json({ success: true, data: solvers, total: solvers.length })
})

// ============================================================================
// GET /selection/:orderId
// ============================================================================

solverRouter.get('/selection/:orderId', (c) => {
  const orderId   = c.req.param('orderId')
  const selection = getSolverSelection(orderId)

  if (!selection) {
    return c.json(
      { success: false, error: 'No RFQ result found for this orderId' },
      404
    )
  }

  return c.json({ success: true, data: selection })
})
