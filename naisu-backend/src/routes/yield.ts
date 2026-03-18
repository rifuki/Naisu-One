/**
 * Yield Routes
 * GET /api/v1/yield/rates — returns live APY data for supported protocols.
 */
import { Hono } from 'hono'
import { getYieldRates } from '@services/yield.service'

export const yieldRouter = new Hono()

/**
 * GET /rates
 * Returns current APY rates for Marinade, marginfi, and Orca.
 * Cached for 5 minutes server-side.
 */
yieldRouter.get('/rates', async (c) => {
  const data = await getYieldRates()
  return c.json({ success: true, data })
})
