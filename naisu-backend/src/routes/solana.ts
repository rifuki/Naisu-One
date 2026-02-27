/**
 * Solana Routes
 * REST API endpoints for Solana operations:
 *   GET /api/v1/solana/balance/:address
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as solanaService from '@services/solana.service'
import { rateLimit } from '@middleware/rate-limit'
import { logger } from '@lib/logger'

export const solanaRouter = new Hono()

// Apply rate limiting to all Solana endpoints
solanaRouter.use('*', rateLimit({ windowMs: 60000, maxRequests: 200 }))

// ============================================================================
// Balance
// ============================================================================

/**
 * GET /balance/:address
 * Returns SOL balance for a wallet address.
 */
solanaRouter.get(
  '/balance/:address',
  zValidator('param', z.object({ address: z.string().min(32).max(44) })),
  async (c) => {
    const { address } = c.req.valid('param')

    logger.info({ address }, 'Fetching SOL balance')

    const balance = await solanaService.getSolBalance(address)

    return c.json({
      success: true,
      data: balance,
    })
  }
)
