/**
 * Portfolio Routes
 * GET  /api/v1/portfolio/balances?wallet=<pubkey>   — SOL + mSOL + USDC balances
 * POST /api/v1/portfolio/unstake-msol               — build unsigned Marinade liquid-unstake tx
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { getPortfolioBalances, buildMarinadeLiquidUnstakeTx } from '../services/portfolio.service'

export const portfolioRouter = new Hono()

// ── GET /balances ─────────────────────────────────────────────────────────────

portfolioRouter.get(
  '/balances',
  zValidator('query', z.object({ wallet: z.string().min(32) })),
  async (c) => {
    const { wallet } = c.req.valid('query')
    try {
      const balances = await getPortfolioBalances(wallet)
      return c.json(balances)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ error: msg }, 400)
    }
  },
)

// ── POST /unstake-msol ────────────────────────────────────────────────────────

portfolioRouter.post(
  '/unstake-msol',
  zValidator(
    'json',
    z.object({
      wallet: z.string().min(32),
      amount: z.string().regex(/^\d+$/, 'amount must be a raw integer string'),
    }),
  ),
  async (c) => {
    const { wallet, amount } = c.req.valid('json')
    if (BigInt(amount) <= 0n) return c.json({ error: 'amount must be > 0' }, 400)
    try {
      const txBase64 = await buildMarinadeLiquidUnstakeTx(wallet, amount)
      return c.json({ tx: txBase64 })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ error: msg }, 500)
    }
  },
)
