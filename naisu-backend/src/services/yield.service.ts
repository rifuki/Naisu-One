/**
 * Yield Service
 * Fetches real APY data from Marinade and marginfi.
 * Results are cached in memory for 5 minutes.
 * Never throws — returns fallback values on API errors.
 */

// ============================================================================
// Types
// ============================================================================

export interface ProtocolRate {
  id: 'marinade' | 'marginfi'
  name: string
  apy: number          // percentage (e.g. 6.82 for 6.82%)
  apyRaw: number       // raw decimal from API (e.g. 0.0682)
  outputToken: string  // 'msol' | 'marginfi'
  receiveLabel: string // 'mSOL' | 'SOL (marginfi)'
  riskLevel: 'low' | 'medium' | 'high'
  riskLabel: string    // 'Liquid staking' | 'Variable lending' | 'LP + IL risk'
  description: string  // short description
  devnetSupported: boolean
  lastUpdated: number  // unix ms timestamp
  error?: string       // set if fetch failed and fallback was used
}

// ============================================================================
// Fallback APYs (used when live APIs are unreachable)
// ============================================================================

const FALLBACK_APYS = {
  marinade: 6.5,
  marginfi: 7.8,
}

// ============================================================================
// In-memory cache (5-minute TTL)
// ============================================================================

const CACHE_TTL_MS = 5 * 60 * 1000

interface Cache {
  rates: ProtocolRate[]
  fetchedAt: number
}

let _cache: Cache | null = null

// ============================================================================
// Fetchers
// ============================================================================

async function fetchMarinadeApy(): Promise<{ apy: number; error?: string }> {
  try {
    const res = await fetch('https://api.marinade.finance/tlv', {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as { apy?: number }
    const apyRaw = typeof data.apy === 'number' ? data.apy : null
    if (apyRaw === null) throw new Error('Missing apy field in Marinade response')
    return { apy: apyRaw }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { apy: FALLBACK_APYS.marinade / 100, error: `Marinade API error: ${msg}` }
  }
}

async function fetchMarginfiApy(): Promise<{ apy: number; error?: string }> {
  try {
    const res = await fetch('https://marginfi-v2-ui-data.vercel.app/banks', {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    // Response may be an array or wrapped object
    const raw = await res.json()
    const banks: unknown[] = Array.isArray(raw) ? raw : (raw?.data ?? [])

    const SOL_MINT = 'So11111111111111111111111111111111111111112'
    const solBank = (banks as Record<string, unknown>[]).find(
      (b) => b['tokenSymbol'] === 'SOL' || b['mint'] === SOL_MINT
    )

    if (!solBank) throw new Error('SOL bank not found in marginfi response')

    // Try multiple field names — use first non-zero value
    const candidates = [
      solBank['lendingRate'],
      solBank['depositRate'],
      solBank['supplyApy'],
    ]
    let apyRaw: number | null = null
    for (const c of candidates) {
      if (typeof c === 'number' && c > 0) {
        apyRaw = c
        break
      }
    }

    if (apyRaw === null) throw new Error('Could not find non-zero lending rate in marginfi SOL bank')

    // If rate is already a percentage (> 1), divide by 100 to get decimal
    // marginfi returns decimals (e.g. 0.078), but guard against percentage form
    if (apyRaw > 1) apyRaw = apyRaw / 100

    return { apy: apyRaw }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { apy: FALLBACK_APYS.marginfi / 100, error: `marginfi API error: ${msg}` }
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Returns yield rates for all supported protocols.
 * Results are cached for 5 minutes.
 * Never throws — always returns data (using fallbacks on error).
 */
export async function getYieldRates(): Promise<ProtocolRate[]> {
  const now = Date.now()

  // Return cached data if fresh
  if (_cache && now - _cache.fetchedAt < CACHE_TTL_MS) {
    return _cache.rates
  }

  // Fetch all in parallel
  const [marinadeResult, marginfiResult] = await Promise.all([
    fetchMarinadeApy(),
    fetchMarginfiApy(),
  ])

  // Convert raw decimal APY → percentage for display
  // If raw value < 1, it's decimal form (0.0682 → 6.82%)
  // If raw value >= 1, assume it's already a percentage
  function toPercent(raw: number): number {
    return raw < 1 ? raw * 100 : raw
  }

  const rates: ProtocolRate[] = [
    {
      id:             'marinade',
      name:           'Marinade Finance',
      apy:            toPercent(marinadeResult.apy),
      apyRaw:         marinadeResult.apy,
      outputToken:    'msol',
      receiveLabel:   'mSOL',
      riskLevel:      'low',
      riskLabel:      'Liquid staking',
      description:    'Stake SOL and receive liquid mSOL tokens earning native staking rewards.',
      devnetSupported: true,
      lastUpdated:    now,
      error:          marinadeResult.error,
    },
    {
      id:             'marginfi',
      name:           'marginfi',
      apy:            toPercent(marginfiResult.apy),
      apyRaw:         marginfiResult.apy,
      outputToken:    'marginfi',
      receiveLabel:   'SOL (marginfi)',
      riskLevel:      'medium',
      riskLabel:      'Variable lending',
      description:    'Lend SOL on marginfi lending protocol and earn variable interest from borrowers.',
      devnetSupported: false,
      lastUpdated:    now,
      error:          marginfiResult.error,
    },
  ]

  _cache = { rates, fetchedAt: now }
  return rates
}
