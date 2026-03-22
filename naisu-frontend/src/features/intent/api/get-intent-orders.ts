import { BACKEND_URL } from '@/lib/env'

const BACKEND_TIMEOUT_MS = 5_000

// ─── Canonical type ───────────────────────────────────────────────────────────

export interface IntentOrder {
  id:               string
  txDigest:         string   // tx hash only (not full URL) — empty for gasless pre-execute
  explorerUrl?:     string   // full block explorer URL
  amount:           number
  startPrice:       number
  floorPrice:       number
  createdAt:        number
  deadline:         number
  destinationChain: number
  status:           'Open' | 'Fulfilled' | 'Cancelled'
  chain:            'evm' | 'solana'
  sourceChain?:     string
  fulfillTxHash?:   string
  recipient?:       string
  solanaPaymentTxHash?: string
  solverAddress?:   string
  isGasless?:       boolean
}

// ─── Backend response → IntentOrder ──────────────────────────────────────────

function fromBackend(o: Record<string, unknown>): IntentOrder {
  const statusMap: Record<string, IntentOrder['status']> = {
    OPEN:      'Open',
    FULFILLED: 'Fulfilled',
    CANCELLED: 'Cancelled',
  }
  const chain       = (o['chain'] as string) === 'solana' ? 'solana' : 'evm'
  const srcChain    = (o['chain'] as string) === 'evm-base' ? 'Base' : undefined
  const explorerUrl = (o['explorerUrl'] as string) ?? ''
  const txDigest    = explorerUrl.includes('/tx/')
    ? (explorerUrl.split('/tx/').pop() ?? '')
    : explorerUrl
  return {
    id:               o['orderId']  as string,
    txDigest,
    explorerUrl:      explorerUrl || undefined,
    amount:           parseFloat(o['amount'] as string),
    startPrice:       parseFloat(o['startPrice'] as string),
    floorPrice:       parseFloat(o['floorPrice'] as string),
    createdAt:        o['createdAt']  as number,
    deadline:         o['deadline']   as number,
    destinationChain: o['destinationChain'] as number,
    status:           statusMap[o['status'] as string] ?? 'Open',
    chain,
    sourceChain:      srcChain,
    recipient:        o['recipient']     as string | undefined,
    fulfillTxHash:    o['fulfillTxHash'] as string | undefined,
    isGasless:        (o['isGasless'] as boolean | undefined) ?? false,
  }
}

// ─── Backend fetch ────────────────────────────────────────────────────────────

export async function getIntentOrders(user: string, chain?: string): Promise<IntentOrder[] | null> {
  const url = `${BACKEND_URL}/api/v1/intent/orders`
  try {
    const params = new URLSearchParams({ user, t: Date.now().toString() })
    if (chain) params.set('chain', chain)
    const res = await fetch(`${url}?${params}`, {
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.warn(`[getIntentOrders] backend ${res.status} for user=${user} chain=${chain ?? 'all'} — falling back to RPC`)
      return null
    }
    const json = await res.json() as { success: boolean; data?: unknown[]; error?: string }
    if (!json.success || !Array.isArray(json.data)) {
      console.warn('[getIntentOrders] backend returned success=false', { user, chain, error: json.error })
      return null
    }
    return json.data.map(o => fromBackend(o as Record<string, unknown>))
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      console.warn(`[getIntentOrders] backend timeout (${BACKEND_TIMEOUT_MS}ms) for user=${user} — falling back to RPC`)
    } else {
      console.error('[getIntentOrders] fetch error', { url, user, chain, error: err })
    }
    return null
  }
}
