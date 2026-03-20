/**
 * Solver Network Routes
 *
 *   POST /api/v1/solver/register    — legacy stub (use WebSocket instead)
 *   POST /api/v1/solver/heartbeat   — legacy stub (use WebSocket instead)
 *   GET  /api/v1/solver/list        — list all solvers + stats
 *   GET  /api/v1/solver/selection/:orderId — RFQ result + winner reasoning
 *
 * NOTE: Solver registration, heartbeat, and step reporting are now handled
 * over WebSocket at /api/v1/solver/ws. The HTTP register/heartbeat/report-step
 * routes are kept as informational stubs so old clients receive a clear error.
 */

import { Hono } from 'hono'
import { listSolvers, getSolverSelection } from '@services/solver.service'
import { rateLimit } from '@middleware/rate-limit'
import { logger } from '@lib/logger'

export const solverRouter = new Hono()

solverRouter.use('*', rateLimit({ windowMs: 60000, maxRequests: 500 }))

// ============================================================================
// POST /register — legacy stub
// ============================================================================

solverRouter.post('/register', async (c) => {
  logger.warn('[Route] Solver HTTP /register called — redirecting to WS')
  return c.json(
    { success: false, error: 'HTTP registration is deprecated. Connect via WebSocket at /api/v1/solver/ws' },
    410
  )
})

// ============================================================================
// POST /heartbeat — legacy stub
// ============================================================================

solverRouter.post('/heartbeat', async (c) => {
  return c.json(
    { success: false, error: 'HTTP heartbeat is deprecated. Send {type:"heartbeat"} over WebSocket at /api/v1/solver/ws' },
    410
  )
})

// ============================================================================
// POST /report-step — legacy stub
// ============================================================================

solverRouter.post('/report-step', async (c) => {
  return c.json(
    { success: false, error: 'HTTP report-step is deprecated. Send {type:"execute_confirmed"|"sol_sent"|"vaa_ready"} over WebSocket at /api/v1/solver/ws' },
    410
  )
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
