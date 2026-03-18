/**
 * Pyth Network Price Service
 *
 * Fetches real-time USD prices from Pyth Hermes REST API.
 * No API key required. No extra dependencies — uses native fetch.
 *
 * Supports: ETH/USD (evm-base), SOL/USD (solana), SUI/USD (sui)
 *
 * Docs: https://docs.pyth.network/price-feeds/api-reference/hermes
 */

import { logger } from '@lib/logger'

// ============================================================================
// Config
// ============================================================================

const HERMES_URL = 'https://hermes.pyth.network'

/** Pyth price feed IDs — keyed by our SupportedChain names */
const FEED_IDS = {
  'evm-base': '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', // ETH/USD
  'solana':   '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d', // SOL/USD
  'sui':      '0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744', // SUI/USD
} as const

type FeedChain = keyof typeof FEED_IDS

// ============================================================================
// Types
// ============================================================================

export interface PythPrice {
  usd: number       // USD price (e.g. 150.23)
  conf: number      // absolute confidence interval in USD
  confPct: number   // confidence as % of price (e.g. 0.05 = 0.05%)
  publishTime: number // unix timestamp of the price
  stale: boolean    // true if price is older than 60s
}

export type PythPrices = Record<string, PythPrice>

// ============================================================================
// Simple in-memory cache (10s TTL)
// ============================================================================

interface CacheEntry {
  prices: PythPrices
  fetchedAt: number
}

let _cache: CacheEntry | null = null
const CACHE_TTL_MS = 10_000

function getCached(): PythPrices | null {
  if (!_cache) return null
  if (Date.now() - _cache.fetchedAt > CACHE_TTL_MS) return null
  return _cache.prices
}

// ============================================================================
// Hermes API response type
// ============================================================================

interface HermesResponse {
  parsed: Array<{
    id: string
    price: {
      price: string
      conf: string
      expo: number
      publish_time: number
    }
  }>
}

// ============================================================================
// Core fetch
// ============================================================================

/**
 * Fetch USD prices from Pyth Hermes for the given chains.
 * Results are cached for 10 seconds.
 *
 * @param chains - array of SupportedChain values to fetch prices for
 * @returns map of chain → PythPrice
 * @throws if Hermes API is unreachable and cache is empty
 */
export async function getPythPrices(chains: string[]): Promise<PythPrices> {
  const cached = getCached()
  if (cached) return cached

  const validChains = chains.filter((c): c is FeedChain => c in FEED_IDS)
  if (validChains.length === 0) {
    throw new Error(`No Pyth feed IDs found for chains: ${chains.join(', ')}`)
  }

  const ids = validChains.map(c => FEED_IDS[c])
  const params = ids.map(id => `ids[]=${id}`).join('&')
  const url = `${HERMES_URL}/v2/updates/price/latest?${params}`

  logger.debug({ url, chains: validChains }, 'Fetching Pyth prices')

  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })

  if (!res.ok) {
    throw new Error(`Pyth Hermes API responded with ${res.status}`)
  }

  const data = await res.json() as HermesResponse
  const now = Math.floor(Date.now() / 1000)
  const result: PythPrices = {}

  for (const parsed of data.parsed) {
    const feedId = '0x' + parsed.id.toLowerCase()
    const chain = (Object.entries(FEED_IDS) as [FeedChain, string][])
      .find(([, id]) => id.toLowerCase() === feedId)?.[0]

    if (!chain) continue

    const expo  = parsed.price.expo
    const scale = Math.pow(10, expo)
    const usd   = parseInt(parsed.price.price) * scale
    const conf  = parseInt(parsed.price.conf) * scale

    result[chain] = {
      usd,
      conf,
      confPct:     usd > 0 ? (conf / usd) * 100 : 0,
      publishTime: parsed.price.publish_time,
      stale:       now - parsed.price.publish_time > 60,
    }
  }

  _cache = { prices: result, fetchedAt: Date.now() }

  logger.info(
    Object.fromEntries(Object.entries(result).map(([k, v]) => [k, `$${v.usd.toFixed(2)}`])),
    'Pyth prices fetched'
  )

  return result
}

/**
 * Convenience: fetch prices for two specific chains and return the FX rate.
 * Returns null if either price is unavailable.
 */
export async function getPythRate(fromChain: string, toChain: string): Promise<{
  rate: number
  fromUsd: number
  toUsd: number
  confidence: number // max confPct of the two feeds
} | null> {
  try {
    const prices = await getPythPrices([fromChain, toChain])
    const from = prices[fromChain]
    const to   = prices[toChain]

    if (!from || !to) return null

    return {
      rate:       from.usd / to.usd,
      fromUsd:    from.usd,
      toUsd:      to.usd,
      confidence: Math.max(from.confPct, to.confPct),
    }
  } catch (err) {
    logger.warn({ fromChain, toChain, err }, 'getPythRate failed')
    return null
  }
}
