/**
 * LiveProgressCard
 *
 * Real-time progress tracker for intent bridge transactions.
 * Replaces polling-based SolverAuctionCard with SSE EventSource.
 *
 * Steps:
 *  1. Order submitted          — immediate (from props)
 *  2. Indexing on-chain        — pulse until 'order_created' SSE event
 *  3. RFQ sent to N solvers    — on 'rfq_broadcast' SSE event
 *  4. Winner selected          — on 'rfq_winner' SSE event
 *  5. Solver filling order     — after winner, before fulfilled
 *  6. Order fulfilled          — on 'order_update' (FULFILLED) event
 */

import { useState, useEffect, useRef } from 'react'

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.trim() || 'http://localhost:3000'

// ── Types ─────────────────────────────────────────────────────────────────────

type StepStatus = 'pending' | 'active' | 'done' | 'error'

interface TimelineStep {
  id: string
  icon: string
  label: string
  detail?: string
  status: StepStatus
  ts?: number
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

// ── Step indicator ────────────────────────────────────────────────────────────

function StepRow({ step }: { step: TimelineStep }) {
  const color = {
    pending: 'text-slate-600',
    active:  'text-amber-400',
    done:    'text-emerald-400',
    error:   'text-red-400',
  }[step.status]

  const dotColor = {
    pending: 'bg-slate-700',
    active:  'bg-amber-400',
    done:    'bg-emerald-400',
    error:   'bg-red-400',
  }[step.status]

  return (
    <div className={`flex items-start gap-3 transition-all duration-500 ${step.status === 'pending' ? 'opacity-30' : 'opacity-100'}`}>
      <div className="flex flex-col items-center shrink-0">
        <span className={`size-2 rounded-full mt-1 ${dotColor} ${step.status === 'active' ? 'animate-pulse' : ''}`} />
      </div>
      <div className="flex-1 min-w-0 pb-3">
        <div className={`flex items-center gap-2 text-xs font-medium ${color}`}>
          <span className={`material-symbols-outlined text-[14px] ${color}`}>{step.icon}</span>
          <span>{step.label}</span>
          {step.status === 'active' && (
            <span className="inline-flex gap-0.5 ml-0.5">
              <span className="size-1 rounded-full bg-current animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="size-1 rounded-full bg-current animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="size-1 rounded-full bg-current animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
          )}
          {step.status === 'done' && (
            <span className="material-symbols-outlined text-[13px] text-emerald-400">check_circle</span>
          )}
        </div>
        {step.detail && step.status !== 'pending' && (
          <p className="mt-0.5 text-[11px] text-slate-500 leading-relaxed">{step.detail}</p>
        )}
      </div>
    </div>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  userAddress: string
  txHash?: string
  submittedAt: number
  orderId?: string
}

// ── Main component ────────────────────────────────────────────────────────────

export default function LiveProgressCard({ userAddress, txHash, submittedAt, orderId: initialOrderId }: Props) {
  const [orderId, setOrderId] = useState<string | null>(initialOrderId ?? null)
  const [steps, setSteps] = useState<TimelineStep[]>([
    {
      id: 'submitted',
      icon: 'upload',
      label: 'Order submitted',
      detail: txHash ? `Tx: ${txHash.slice(0, 10)}…${txHash.slice(-6)}` : undefined,
      status: 'done',
    },
    {
      id: 'indexing',
      icon: 'link',
      label: 'Indexing on-chain…',
      status: 'active',
    },
    {
      id: 'rfq',
      icon: 'cell_tower',
      label: 'Broadcasting to solvers',
      status: 'pending',
    },
    {
      id: 'winner',
      icon: 'emoji_events',
      label: 'Selecting best solver',
      status: 'pending',
    },
    {
      id: 'filling',
      icon: 'pending',
      label: 'Solver filling order…',
      status: 'pending',
    },
    {
      id: 'fulfilled',
      icon: 'check_circle',
      label: 'Order fulfilled!',
      status: 'pending',
    },
  ])
  const [exclusivityDeadline, setExclusivityDeadline] = useState<number | null>(null)
  const [isDone, setIsDone] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  const exclusive = useCountdown(exclusivityDeadline)

  // Helper to mutate a specific step
  const updateStep = (id: string, patch: Partial<TimelineStep>) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
  }

  // Connect SSE
  useEffect(() => {
    if (isDone) return

    const url = `${BACKEND_URL}/api/v1/intent/watch?user=${userAddress}&chain=evm-base`
    const es = new EventSource(url)
    esRef.current = es

    es.addEventListener('order_created', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { orderId: string }
        if (!orderId) setOrderId(data.orderId)
        updateStep('indexing', { status: 'done', label: 'Order indexed on-chain', detail: `Order ID: ${data.orderId.slice(0, 12)}…` })
        updateStep('rfq', { status: 'active', label: 'Broadcasting to solvers…' })
      } catch { /* suppress */ }
    })

    es.addEventListener('rfq_broadcast', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { orderId: string; solverCount: number; solverNames: string[] }
        // Only apply if no orderId filter or matches our order (SSE is global, not user-scoped on solver events)
        updateStep('rfq', {
          status: 'done',
          label: `RFQ sent to ${data.solverCount} solver${data.solverCount !== 1 ? 's' : ''}`,
          detail: data.solverNames.join(' · '),
        })
        updateStep('winner', { status: 'active', label: 'Collecting quotes…' })
      } catch { /* suppress */ }
    })

    es.addEventListener('rfq_winner', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as {
          orderId: string; winner: string; score: number;
          reasoning: string; estimatedETA: number; exclusivityDeadline: number
        }
        setExclusivityDeadline(data.exclusivityDeadline)
        updateStep('winner', {
          status: 'done',
          label: `Winner: ${data.winner}`,
          detail: `${data.reasoning} — ETA ${data.estimatedETA}s`,
        })
        updateStep('filling', { status: 'active', label: `${data.winner} is filling the order…` })
      } catch { /* suppress */ }
    })

    es.addEventListener('order_fulfilled', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { solverName?: string }
        const by = data.solverName ? ` by ${data.solverName}` : ''
        // Complete any pending steps
        setSteps(prev => prev.map(s => {
          if (s.status === 'active' || s.status === 'pending') {
            return { ...s, status: 'done' }
          }
          return s
        }))
        updateStep('fulfilled', { status: 'done', label: `Order fulfilled${by}! 🎉` })
        setIsDone(true)
      } catch { /* suppress */ }
    })

    es.addEventListener('order_update', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { status: string; orderId: string }
        if (data.status === 'FULFILLED') {
          setSteps(prev => prev.map(s => ({
            ...s,
            status: (s.status === 'pending' || s.status === 'active') ? 'done' : s.status
          })))
          updateStep('fulfilled', { status: 'done', label: 'Order fulfilled! 🎉' })
          setIsDone(true)
        } else if (data.status === 'EXPIRED') {
          updateStep('filling', { status: 'error', label: 'Auction expired — no solver filled in time' })
        }
      } catch { /* suppress */ }
    })

    es.onerror = () => {
      // EventSource auto-reconnects; suppress visual noise
    }

    return () => {
      es.close()
      esRef.current = null
    }
  }, [userAddress, isDone, orderId])

  // Mark indexing timeout after 30s if still active
  useEffect(() => {
    const t = setTimeout(() => {
      setSteps(prev => prev.map(s =>
        s.id === 'indexing' && s.status === 'active'
          ? { ...s, detail: 'Taking longer than expected — still watching…' }
          : s
      ))
    }, 30_000)
    return () => clearTimeout(t)
  }, [])

  const header = isDone ? '✅ COMPLETE' : '⚡ LIVE PROGRESS'
  const headerColor = isDone ? 'text-emerald-400' : 'text-primary'

  return (
    <div className="mt-3 rounded-xl border border-primary/20 bg-gradient-to-b from-primary/5 to-black/10 overflow-hidden text-xs">
      {/* Header */}
      <div className="px-3 py-2 bg-primary/10 border-b border-primary/15 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`material-symbols-outlined text-sm ${headerColor}`}>
            {isDone ? 'check_circle' : 'bolt'}
          </span>
          <span className={`font-bold uppercase tracking-wider ${headerColor}`}>{header}</span>
        </div>
        {exclusive > 0 && (
          <div className="flex items-center gap-1.5 text-amber-400">
            <span className="material-symbols-outlined text-xs">timer</span>
            <span className="font-mono font-bold">{exclusive}s exclusive</span>
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="px-3 pt-3 pb-1">
        {steps.map(step => (
          <StepRow key={step.id} step={step} />
        ))}
      </div>

      {/* No solver fallback note */}
      {steps.find(s => s.id === 'rfq' && s.status === 'active') && (
        <p className="px-3 pb-3 text-[11px] text-slate-600">
          No registered solvers — running as open Dutch auction. Any solver can fill.
        </p>
      )}
    </div>
  )
}
