import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface SwapProgressStep {
  key: string
  label: string
  detail?: string
  txHash?: string
  done: boolean
  active: boolean
  error?: boolean
}

export interface ActiveSwap {
  intentId: string       // from submission
  orderId?: string       // set after gasless_resolved
  submittedAt: number
  progress: SwapProgressStep[]
  isFulfilled: boolean
  solverName?: string
}

export const INITIAL_SWAP_PROGRESS: SwapProgressStep[] = [
  { key: 'signed',        label: 'Signed & submitted',  detail: 'Gasless intent relayed',           done: true,  active: false },
  { key: 'rfq',           label: 'Broadcasting RFQ',    detail: 'Requesting quotes from solvers…',  done: false, active: true  },
  { key: 'winner',        label: 'Selecting solver',    detail: 'Evaluating solver quotes…',         done: false, active: false },
  { key: 'evm_submitted', label: 'EVM submitted',       detail: 'Solver calling executeIntent()…',  done: false, active: false },
  { key: 'sol_sent',      label: 'Sending to Solana',   detail: 'SOL transfer in progress…',        done: false, active: false },
  { key: 'vaa_ready',     label: 'Cross-chain proof',   detail: 'Fetching Wormhole VAA…',           done: false, active: false },
  { key: 'settled',       label: 'Bridge settled',      detail: 'Waiting for confirmation…',        done: false, active: false },
]

interface SwapState {
  activeSwap: ActiveSwap | null
  setActiveSwap: (swap: ActiveSwap) => void
  updateSwapProgress: (progress: SwapProgressStep[]) => void
  updateSwapOrderId: (orderId: string) => void
  markSwapFulfilled: (solverName?: string) => void
  clearActiveSwap: () => void
}

export const useSwapStore = create<SwapState>()(
  persist(
    (set) => ({
      activeSwap: null,

      setActiveSwap: (swap) => set({ activeSwap: swap }),

      updateSwapProgress: (progress) =>
        set((s) => ({ activeSwap: s.activeSwap ? { ...s.activeSwap, progress } : null })),

      updateSwapOrderId: (orderId) =>
        set((s) => ({ activeSwap: s.activeSwap ? { ...s.activeSwap, orderId } : null })),

      markSwapFulfilled: (solverName) =>
        set((s) => ({
          activeSwap: s.activeSwap ? {
            ...s.activeSwap,
            isFulfilled: true,
            solverName,
            progress: s.activeSwap.progress.map((p) => ({ ...p, done: true, active: false })),
          } : null,
        })),

      clearActiveSwap: () => set({ activeSwap: null }),
    }),
    { name: 'naisu-active-swap' }
  )
)
