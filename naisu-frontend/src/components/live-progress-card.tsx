/**
 * LiveProgressCard
 *
 * Real-time cross-chain progress tracker for /swap gasless intents.
 * Uses useOrderWatch SSE hook with orderId filtering.
 *
 * Steps mirror the intent agent's 7-step flow:
 *  1. Signed & submitted  — immediate
 *  2. Broadcasting RFQ    — rfq_broadcast
 *  3. Selecting solver    — rfq_winner
 *  4. EVM submitted       — execute_sent
 *  5. Sending to Solana   — sol_sent
 *  6. Cross-chain proof   — vaa_ready
 *  7. Bridge settled      — settled
 */

import { useState, useRef } from 'react'
import { CheckCircle2, LucideIcon, Zap } from 'lucide-react'
import { useOrderWatch, type OrderFulfilledEvent } from '@/hooks/use-order-watch'

// ── Types ─────────────────────────────────────────────────────────────────────

type StepStatus = 'pending' | 'active' | 'done' | 'error'

interface TimelineStep {
  key: string
  label: string
  detail?: string
  txHash?: string
  status: StepStatus
}

// ── Step row ──────────────────────────────────────────────────────────────────

function StepRow({ step }: { step: TimelineStep }) {
  const dotColor = {
    pending: 'bg-slate-700',
    active:  'bg-primary',
    done:    'bg-emerald-400',
    error:   'bg-red-400',
  }[step.status]

  const textColor = {
    pending: 'text-slate-600',
    active:  'text-primary',
    done:    'text-emerald-400',
    error:   'text-red-400',
  }[step.status]

  return (
    <div className={`flex items-start gap-3 transition-all duration-500 ${step.status === 'pending' ? 'opacity-30' : 'opacity-100'}`}>
      <div className="flex flex-col items-center shrink-0">
        <span className={`size-2 rounded-full mt-1 ${dotColor} ${step.status === 'active' ? 'animate-pulse' : ''}`} />
      </div>
      <div className="flex-1 min-w-0 pb-3">
        <div className={`flex items-center gap-2 text-xs font-medium ${textColor}`}>
          <span>{step.label}</span>
          {step.status === 'active' && (
            <span className="inline-flex gap-0.5 ml-0.5">
              <span className="size-1 rounded-full bg-current animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="size-1 rounded-full bg-current animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="size-1 rounded-full bg-current animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
          )}
          {step.status === 'done' && (
            <CheckCircle2 size={13} strokeWidth={1.5} className="text-emerald-400" />
          )}
        </div>
        {step.detail && step.status !== 'pending' && (
          <p className="mt-0.5 text-[11px] text-slate-500 leading-relaxed">{step.detail}</p>
        )}
        {step.txHash && step.status !== 'pending' && (
          <p className="mt-0.5 text-[11px] text-slate-600 font-mono truncate">{step.txHash.slice(0, 12)}…{step.txHash.slice(-6)}</p>
        )}
      </div>
    </div>
  )
}

// ── Initial steps ─────────────────────────────────────────────────────────────

const INITIAL_STEPS: TimelineStep[] = [
  { key: 'signed',        label: 'Signed & submitted',  detail: 'Gasless intent relayed',           status: 'done'    },
  { key: 'rfq',           label: 'Broadcasting RFQ',    detail: 'Requesting quotes from solvers…',  status: 'active'  },
  { key: 'winner',        label: 'Selecting solver',    detail: 'Evaluating solver quotes…',         status: 'pending' },
  { key: 'evm_submitted', label: 'EVM submitted',       detail: 'Solver calling executeIntent()…',  status: 'pending' },
  { key: 'sol_sent',      label: 'Sending to Solana',   detail: 'SOL transfer in progress…',        status: 'pending' },
  { key: 'vaa_ready',     label: 'Cross-chain proof',   detail: 'Fetching Wormhole VAA…',           status: 'pending' },
  { key: 'settled',       label: 'Bridge settled',      detail: 'Waiting for confirmation…',        status: 'pending' },
]

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  userAddress: string
  submittedAt: number
  orderId?: string   // intentId from gasless submission
}

// ── Main component ────────────────────────────────────────────────────────────

export default function LiveProgressCard({ userAddress, orderId: initialOrderId }: Props) {
  const [steps, setSteps] = useState<TimelineStep[]>(INITIAL_STEPS)
  const [isDone, setIsDone] = useState(false)

  const orderIdRef  = useRef<string | null>(initialOrderId ?? null)
  const prevIdRef   = useRef<string | null>(null)

  const matches = (id: string) =>
    id === orderIdRef.current || id === prevIdRef.current

  const patch = (updates: Record<string, Partial<TimelineStep>>) =>
    setSteps((prev) => prev.map((s) => updates[s.key] ? { ...s, ...updates[s.key] } : s))

  useOrderWatch({
    user: userAddress,
    enabled: !isDone,

    onGaslessResolved: (intentId, contractOrderId) => {
      if (orderIdRef.current?.toLowerCase() === intentId.toLowerCase()) {
        prevIdRef.current  = orderIdRef.current
        orderIdRef.current = contractOrderId
      }
    },

    onProgress: (evt) => {
      if (!matches(evt.orderId)) return

      if (evt.type === 'rfq_broadcast') {
        const count = (evt.data['solverCount'] as number) ?? 0
        patch({ rfq: { status: 'active', label: count > 0 ? `Broadcasting RFQ to ${count} solver${count !== 1 ? 's' : ''}` : 'Waiting for solvers…' } })

      } else if (evt.type === 'rfq_winner') {
        const winner = evt.data['winner'] as string | undefined
        const priceRaw = evt.data['quotedPrice'] as string | undefined
        const priceSol = priceRaw ? (Number(BigInt(priceRaw)) / 1e9).toFixed(4) : undefined
        patch({
          rfq:    { status: 'done',  active: false },
          winner: { status: 'active', label: winner ? `Solver: ${winner}` : 'Solver selected', detail: priceSol ? `${priceSol} SOL` : undefined },
        })

      } else if (evt.type === 'execute_sent') {
        const tx = evt.data['txHash'] as string | undefined
        patch({
          rfq:          { status: 'done' },
          winner:       { status: 'done' },
          evm_submitted: { status: 'active', txHash: tx },
        })

      } else if (evt.type === 'sol_sent') {
        const tx = evt.data['txHash'] as string | undefined
        patch({
          rfq:          { status: 'done' },
          winner:       { status: 'done' },
          evm_submitted: { status: 'done', detail: 'Submitted on-chain' },
          sol_sent:      { status: 'active', txHash: tx },
        })

      } else if (evt.type === 'vaa_ready') {
        const solTx = steps.find((s) => s.key === 'sol_sent')?.txHash
        patch({
          rfq:          { status: 'done' },
          winner:       { status: 'done' },
          evm_submitted: { status: 'done' },
          sol_sent:      { status: 'done', detail: 'Transfer complete' },
          vaa_ready:     { status: 'active', txHash: solTx },
        })

      } else if (evt.type === 'settled') {
        const tx = evt.data['txHash'] as string | undefined
        setSteps((prev) => prev.map((s) =>
          s.key === 'settled'
            ? { ...s, status: 'done', txHash: tx, detail: undefined }
            : { ...s, status: 'done' }
        ))
        setIsDone(true)
      }
    },

    onOrderFulfilled: (data: OrderFulfilledEvent) => {
      if (!matches(data.orderId)) return
      // Mark all steps done — settled event may still arrive with txHash
      setSteps((prev) => prev.map((s) =>
        s.key === 'settled' ? { ...s, status: 'active' } : { ...s, status: 'done' }
      ))
    },

    onOrderUpdate: (evt) => {
      if (!matches(evt.orderId)) return
      if (evt.status === 'FULFILLED') {
        setSteps((prev) => prev.map((s) =>
          s.key === 'settled' ? { ...s, status: 'active' } : { ...s, status: 'done' }
        ))
      } else if (evt.status === 'EXPIRED') {
        setSteps((prev) => prev.map((s) =>
          s.active ? { ...s, status: 'error', detail: 'Expired — no solver filled in time' } : s
        ))
        setIsDone(true)
      }
    },
  })

  const allDone = steps.every((s) => s.status === 'done')
  const headerColor = allDone ? 'text-emerald-400' : 'text-primary'

  return (
    <div className="mt-3 rounded-xl border border-primary/20 bg-gradient-to-b from-primary/5 to-black/10 overflow-hidden text-xs">
      <div className="px-3 py-2 bg-primary/10 border-b border-primary/15 flex items-center gap-2">
        {allDone
          ? <CheckCircle2 size={14} strokeWidth={1.5} className={headerColor} />
          : <Zap size={14} strokeWidth={1.5} className={`${headerColor} animate-pulse`} />
        }
        <span className={`font-bold uppercase tracking-wider ${headerColor}`}>
          {allDone ? '✅ Complete' : '⚡ Live Progress'}
        </span>
      </div>
      <div className="px-3 pt-3 pb-1">
        {steps.map((step) => <StepRow key={step.key} step={step} />)}
      </div>
    </div>
  )
}
