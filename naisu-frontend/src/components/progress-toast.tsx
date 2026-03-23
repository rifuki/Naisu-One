/**
 * ProgressToastMonitor
 *
 * Global component (always mounted) that shows Sonner toasts when the user
 * navigates away from an active swap (/swap) or intent (/intent).
 *
 * - /swap progress  → subscribes to SSE, updates swapStore, shows toast off /swap
 * - /intent progress → reads intentStore (updated by intent.tsx), shows toast off /intent
 */

import { useEffect, useRef } from 'react'
import { useRouterState, useNavigate } from '@tanstack/react-router'
import { useAccount } from 'wagmi'
import { toast } from 'sonner'
import { useIntentStore } from '@/store/intent-store'
import { useSwapStore, INITIAL_SWAP_PROGRESS } from '@/store/swap-store'
import { useOrderWatch, type OrderFulfilledEvent } from '@/hooks/use-order-watch'

const SWAP_TOAST_ID   = 'naisu-swap-progress'
const INTENT_TOAST_ID = 'naisu-intent-progress'

export function ProgressToastMonitor() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const navigate  = useNavigate()
  const { address } = useAccount()

  const onSwap   = pathname === '/swap'
  const onIntent = pathname === '/intent' || pathname === '/'

  // ── Swap store ───────────────────────────────────────────────────────────
  const activeSwap          = useSwapStore((s) => s.activeSwap)
  const updateSwapProgress  = useSwapStore((s) => s.updateSwapProgress)
  const updateSwapOrderId   = useSwapStore((s) => s.updateSwapOrderId)
  const markSwapFulfilled   = useSwapStore((s) => s.markSwapFulfilled)

  const swapOrderIdRef  = useRef<string | null>(null)
  const swapPrevIdRef   = useRef<string | null>(null)

  // Keep refs in sync with store
  useEffect(() => {
    swapOrderIdRef.current = activeSwap?.orderId ?? activeSwap?.intentId ?? null
  }, [activeSwap?.orderId, activeSwap?.intentId])

  const swapMatches = (id: string) =>
    id === swapOrderIdRef.current || id === swapPrevIdRef.current

  // ── Intent store ─────────────────────────────────────────────────────────
  const activeIntent = useIntentStore((s) => s.activeIntent)

  // ── Swap toast effect ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeSwap || activeSwap.isFulfilled) {
      toast.dismiss(SWAP_TOAST_ID)
      return
    }
    if (onSwap) {
      toast.dismiss(SWAP_TOAST_ID)
      return
    }

    const activeStep = activeSwap.progress.find((s) => s.active)
    toast.loading(activeStep?.label ?? 'Swap in progress…', {
      id: SWAP_TOAST_ID,
      description: activeStep?.detail,
      action: { label: 'View', onClick: () => navigate({ to: '/swap' }) },
      duration: Infinity,
    })
  }, [activeSwap, onSwap, navigate])

  // ── Intent toast effect ───────────────────────────────────────────────────
  useEffect(() => {
    if (!activeIntent || activeIntent.isFulfilled) {
      toast.dismiss(INTENT_TOAST_ID)
      return
    }
    if (onIntent) {
      toast.dismiss(INTENT_TOAST_ID)
      return
    }

    const activeStep = activeIntent.progress.find((s) => s.active)
    toast.loading(activeStep?.label ?? 'Bridge in progress…', {
      id: INTENT_TOAST_ID,
      description: activeStep?.detail,
      action: { label: 'View', onClick: () => navigate({ to: '/intent' }) },
      duration: Infinity,
    })
  }, [activeIntent, onIntent, navigate])

  // ── SSE subscription for swap (always active when swap pending) ───────────
  useOrderWatch({
    user: address,
    enabled: !!address && !!activeSwap && !activeSwap.isFulfilled,

    onGaslessResolved: (intentId, contractOrderId) => {
      const swap = useSwapStore.getState().activeSwap
      if (!swap) return
      const tracked = (swap.orderId ?? swap.intentId)?.toLowerCase()
      if (tracked === intentId.toLowerCase()) {
        swapPrevIdRef.current  = swapOrderIdRef.current
        swapOrderIdRef.current = contractOrderId
        updateSwapOrderId(contractOrderId)
      }
    },

    onProgress: (evt) => {
      const swap = useSwapStore.getState().activeSwap
      if (!swap || !swapMatches(evt.orderId)) return

      const progress = [...swap.progress]

      const patch = (updates: Record<string, object>) =>
        progress.map((s) => updates[s.key] ? { ...s, ...updates[s.key] } : s)

      let updated = progress

      if (evt.type === 'rfq_broadcast') {
        const count = (evt.data['solverCount'] as number) ?? 0
        updated = patch({ rfq: { active: true, label: count > 0 ? `Broadcasting RFQ to ${count} solver${count !== 1 ? 's' : ''}` : 'Waiting for solvers…' } })

      } else if (evt.type === 'rfq_winner') {
        const winner   = evt.data['winner'] as string | undefined
        const priceRaw = evt.data['quotedPrice'] as string | undefined
        const priceSol = priceRaw ? (Number(BigInt(priceRaw)) / 1e9).toFixed(4) : undefined
        updated = patch({
          rfq:    { done: true, active: false },
          winner: { active: true, label: winner ? `Solver: ${winner}` : 'Solver selected', detail: priceSol ? `${priceSol} SOL` : undefined },
        })

      } else if (evt.type === 'execute_sent') {
        const tx = evt.data['txHash'] as string | undefined
        updated = patch({
          rfq:           { done: true, active: false },
          winner:        { done: true, active: false },
          evm_submitted: { active: true, txHash: tx },
        })

      } else if (evt.type === 'sol_sent') {
        const tx = evt.data['txHash'] as string | undefined
        updated = patch({
          rfq:           { done: true, active: false },
          winner:        { done: true, active: false },
          evm_submitted: { done: true, active: false },
          sol_sent:      { active: true, txHash: tx },
        })

      } else if (evt.type === 'vaa_ready') {
        const solTx = progress.find((s) => s.key === 'sol_sent')?.txHash
        updated = patch({
          rfq:           { done: true, active: false },
          winner:        { done: true, active: false },
          evm_submitted: { done: true, active: false },
          sol_sent:      { done: true, active: false },
          vaa_ready:     { active: true, txHash: solTx },
        })

      } else if (evt.type === 'settled') {
        const tx = evt.data['txHash'] as string | undefined
        updated = progress.map((s) =>
          s.key === 'settled' ? { ...s, done: true, active: false, txHash: tx } : { ...s, done: true, active: false }
        )
      }

      updateSwapProgress(updated)
    },

    onOrderFulfilled: (data: OrderFulfilledEvent) => {
      const swap = useSwapStore.getState().activeSwap
      if (!swap || !swapMatches(data.orderId)) return
      markSwapFulfilled(data.data?.solverName)
      toast.success('Swap complete! 🎉', {
        id: SWAP_TOAST_ID,
        description: data.data?.solverName ? `Filled by ${data.data.solverName}` : undefined,
        action: { label: 'View', onClick: () => navigate({ to: '/swap' }) },
        duration: 8000,
      })
    },

    onOrderUpdate: (evt) => {
      const swap = useSwapStore.getState().activeSwap
      if (!swap || !swapMatches(evt.orderId)) return
      if (evt.status === 'FULFILLED') {
        markSwapFulfilled()
        toast.success('Swap complete! 🎉', {
          id: SWAP_TOAST_ID,
          action: { label: 'View', onClick: () => navigate({ to: '/swap' }) },
          duration: 8000,
        })
      }
    },
  })

  return null
}
