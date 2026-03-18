/**
 * SolverAuctionCard
 *
 * Embedded in the chat after a tx is submitted.
 * Watches the backend for the new orderId, then polls RFQ selection
 * and renders a live solver comparison table.
 */

import { useState, useEffect } from 'react'

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.trim() || 'http://localhost:3000'

// ── Types (mirrors backend solver.service.ts) ─────────────────────────────────

interface Quote {
  solverId:     string
  solverName:   string
  quotedPrice:  string   // lamports
  estimatedETA: number
  score:        number
  winner:       boolean
}

interface RFQResult {
  orderId:             string
  rfqSentAt:           number
  quotes:              Quote[]
  winner:              string | null
  reasoning:           string
  exclusivityDeadline: number | null
}

interface SolverInfo {
  name:             string
  online:           boolean
  tier:             number
  reliabilityScore: number
  totalFills:       number
  suspended:        boolean
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchOrders(user: string): Promise<Array<{ orderId: string; createdAt: number }>> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/intent/orders?user=${user}&chain=evm-base`, {
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return []
    const json = await res.json() as { data?: Array<Record<string, unknown>> }
    return (json.data ?? []).map(o => ({ orderId: o['orderId'] as string, createdAt: o['createdAt'] as number }))
  } catch { return [] }
}

async function fetchSelection(orderId: string): Promise<RFQResult | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/solver/selection/${orderId}`, {
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return null
    const json = await res.json() as { data?: RFQResult }
    return json.data ?? null
  } catch { return null }
}

async function fetchSolvers(): Promise<SolverInfo[]> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/solver/list`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return []
    const json = await res.json() as { data?: SolverInfo[] }
    return json.data ?? []
  } catch { return [] }
}

// ── Countdown hook ────────────────────────────────────────────────────────────

function useCountdown(deadlineMs: number | null): number {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    if (!deadlineMs) return
    const update = () => setSecs(Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000)))
    update()
    const t = setInterval(update, 500)
    return () => clearInterval(t)
  }, [deadlineMs])
  return secs
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  userAddress: string
  submittedAt: number
}

export default function SolverAuctionCard({ userAddress, submittedAt }: Props) {
  const [phase,   setPhase]   = useState<'indexing' | 'rfq' | 'done' | 'timeout'>('indexing')
  const [orderId, setOrderId] = useState<string | null>(null)
  const [result,  setResult]  = useState<RFQResult | null>(null)
  const [solvers, setSolvers] = useState<SolverInfo[]>([])

  const countdown = useCountdown(result?.exclusivityDeadline ?? null)

  // Fetch active solvers immediately
  useEffect(() => {
    fetchSolvers().then(setSolvers)
  }, [])

  // Poll orders until we detect the new one
  useEffect(() => {
    let stopped = false
    const poll = async () => {
      while (!stopped) {
        const orders = await fetchOrders(userAddress)
        const found  = orders.find(o => o.createdAt >= submittedAt - 8_000)
        if (found) {
          setOrderId(found.orderId)
          setPhase('rfq')
          return
        }
        await new Promise(r => setTimeout(r, 1500))
      }
    }
    const timeout = setTimeout(() => { stopped = true; setPhase('timeout') }, 30_000)
    poll()
    return () => { stopped = true; clearTimeout(timeout) }
  }, [userAddress, submittedAt])

  // Poll RFQ selection once orderId is known
  useEffect(() => {
    if (!orderId || phase !== 'rfq') return
    let stopped = false
    const poll = async () => {
      while (!stopped) {
        const sel = await fetchSelection(orderId)
        if (sel && sel.quotes.length > 0) {
          setResult(sel)
          setPhase('done')
          return
        }
        await new Promise(r => setTimeout(r, 1000))
      }
    }
    const timeout = setTimeout(() => { stopped = true; if (phase === 'rfq') setPhase('timeout') }, 15_000)
    poll()
    return () => { stopped = true; clearTimeout(timeout) }
  }, [orderId, phase])

  const onlineSolvers = solvers.filter(s => s.online && !s.suspended)

  return (
    <div className="mt-3 rounded-xl border border-primary/20 bg-gradient-to-b from-primary/5 to-black/10 overflow-hidden text-xs">
      {/* Header */}
      <div className="px-3 py-2 bg-primary/10 border-b border-primary/15 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-sm text-primary">group</span>
          <span className="font-bold text-primary uppercase tracking-wider">Solver Auction</span>
        </div>
        {phase === 'done' && result?.exclusivityDeadline && countdown > 0 && (
          <div className="flex items-center gap-1.5 text-amber-400">
            <span className="material-symbols-outlined text-xs">timer</span>
            <span className="font-mono font-bold">{countdown}s exclusive</span>
          </div>
        )}
      </div>

      <div className="p-3 space-y-3">
        {/* Phase: indexing */}
        {(phase === 'indexing' || phase === 'rfq') && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-slate-400">
              <span className={`size-1.5 rounded-full ${phase === 'indexing' ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
              <span>{phase === 'indexing' ? 'Indexing order on-chain...' : 'Order detected'}</span>
            </div>
            {phase === 'rfq' && onlineSolvers.length > 0 && (
              <div className="flex items-center gap-2 text-slate-400">
                <span className="size-1.5 rounded-full bg-amber-400 animate-pulse" />
                <span>Broadcasting RFQ to {onlineSolvers.length} solver{onlineSolvers.length !== 1 ? 's' : ''}...</span>
              </div>
            )}
            {onlineSolvers.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {onlineSolvers.map(s => (
                  <span key={s.name} className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-slate-400">
                    {s.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Phase: done — comparison table */}
        {phase === 'done' && result && (
          <div className="space-y-2">
            {result.quotes.length === 0 ? (
              <p className="text-slate-500">No quotes received — open race active.</p>
            ) : (
              <>
                <table className="w-full">
                  <thead>
                    <tr className="text-slate-500 border-b border-white/5">
                      <th className="text-left pb-1.5 font-medium">Solver</th>
                      <th className="text-right pb-1.5 font-medium">Quote</th>
                      <th className="text-right pb-1.5 font-medium">ETA</th>
                      <th className="text-right pb-1.5 font-medium">Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {result.quotes.map((q, i) => (
                      <tr key={q.solverId} className={q.winner ? 'text-white' : 'text-slate-500'}>
                        <td className="py-1.5 flex items-center gap-1.5">
                          {q.winner
                            ? <span className="text-primary font-bold">★</span>
                            : <span className="text-slate-700">{i + 1}.</span>
                          }
                          <span className={q.winner ? 'font-semibold text-primary' : ''}>{q.solverName}</span>
                        </td>
                        <td className="text-right py-1.5 font-mono">
                          {(parseInt(q.quotedPrice) / 1e9).toFixed(4)} SOL
                        </td>
                        <td className="text-right py-1.5">{q.estimatedETA}s</td>
                        <td className={`text-right py-1.5 font-bold ${q.winner ? 'text-primary' : ''}`}>
                          {q.score.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Winner reasoning */}
                <div className="pt-1 flex items-start gap-2 text-slate-400 border-t border-white/5">
                  <span className="material-symbols-outlined text-xs text-primary mt-0.5 flex-shrink-0">info</span>
                  <span>{result.reasoning}</span>
                </div>

                {/* Exclusivity status */}
                {result.exclusivityDeadline && (
                  countdown > 0
                    ? (
                      <div className="flex items-center gap-1.5 text-amber-400/80 text-[11px]">
                        <span className="material-symbols-outlined text-xs">lock</span>
                        <span>
                          <span className="font-semibold">{result.winner}</span> has {countdown}s exclusive window.
                          After that, any solver can fill.
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-slate-500 text-[11px]">
                        <span className="material-symbols-outlined text-xs">lock_open</span>
                        <span>Exclusive window expired — open race active.</span>
                      </div>
                    )
                )}
              </>
            )}
          </div>
        )}

        {/* Phase: timeout */}
        {phase === 'timeout' && (
          <p className="text-slate-500">
            {onlineSolvers.length === 0
              ? 'No active solvers registered. Falling back to open Dutch auction.'
              : 'RFQ timed out. Falling back to open Dutch auction.'}
          </p>
        )}
      </div>
    </div>
  )
}
