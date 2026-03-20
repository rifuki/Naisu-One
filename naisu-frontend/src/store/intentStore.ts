/**
 * Intent Store - Global state for active intent progress
 * Using Zustand with persist middleware for localStorage
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ProgressStep {
  key: string;
  label: string;
  detail?: string;
  txHash?: string;  // Inline tx hash shown in progress step (optional)
  done: boolean;
  active: boolean;
  error?: boolean;
}

export interface ActiveIntent {
  intentId: string;
  sessionId?: string;          // Chat session this intent belongs to (for cross-session isolation)
  contractOrderId?: string;
  sourceTxHash?: string;       // EVM executeIntent tx hash on Base Sepolia
  settledTxHash?: string;      // EVM settle tx hash on Base Sepolia
  destinationTxHash?: string;  // Destination chain tx hash (e.g. Solana)
  progress: ProgressStep[];
  progressUpdatedAt?: number; // Timestamp of last progress update
  isFulfilled: boolean;
  fillPrice?: string;
  winnerSolver?: string;
  signedAt?: number;
  fulfilledAt?: number;
}

interface IntentState {
  // Active intent being tracked
  activeIntent: ActiveIntent | null;
  // History of completed intents for looking up final state
  completedIntents: Record<string, ActiveIntent>; // key: intentId

  // Actions
  setActiveIntent: (intent: ActiveIntent | null) => void;
  updateProgress: (progress: ProgressStep[]) => void;
  updateIntentId: (contractOrderId: string) => void;
  setSourceTxHash: (hash: string) => void;
  setSettledTxHash: (hash: string) => void;
  setDestinationTxHash: (hash: string) => void;
  markFulfilled: (fillPrice?: string, winnerSolver?: string) => void;
  clearActiveIntent: () => void;
  getCompletedIntent: (intentId: string) => ActiveIntent | undefined;
}

export const useIntentStore = create<IntentState>()(
  persist(
    (set, get) => ({
      activeIntent: null,
      completedIntents: {},
      
      setActiveIntent: (intent) => set({ activeIntent: intent }),
      
      updateProgress: (progress) =>
        set((state) => {
          const updated = state.activeIntent
            ? { ...state.activeIntent, progress, progressUpdatedAt: Date.now() }
            : null;
          // Keep completedIntents snapshot in sync so late-arriving events (e.g. settled txHash)
          // are reflected even after markFulfilled has already snapshotted the intent.
          const completedIntents =
            updated?.isFulfilled
              ? { ...state.completedIntents, [updated.intentId]: updated }
              : state.completedIntents;
          return { activeIntent: updated, completedIntents };
        }),
      
      updateIntentId: (contractOrderId) =>
        set((state) => ({
          activeIntent: state.activeIntent
            ? { ...state.activeIntent, contractOrderId }
            : null
        })),

      setSourceTxHash: (hash) =>
        set((state) => ({
          activeIntent: state.activeIntent
            ? { ...state.activeIntent, sourceTxHash: hash }
            : null
        })),

      setSettledTxHash: (hash) =>
        set((state) => ({
          activeIntent: state.activeIntent
            ? { ...state.activeIntent, settledTxHash: hash }
            : null
        })),

      setDestinationTxHash: (hash) =>
        set((state) => ({
          activeIntent: state.activeIntent
            ? { ...state.activeIntent, destinationTxHash: hash }
            : null
        })),

      markFulfilled: (fillPrice, winnerSolver) =>
        set((state) => {
          const fulfilledIntent = state.activeIntent
            ? {
                ...state.activeIntent,
                isFulfilled: true,
                fulfilledAt: Date.now(),
                fillPrice: fillPrice || state.activeIntent.fillPrice,
                winnerSolver: winnerSolver || state.activeIntent.winnerSolver,
                progress: state.activeIntent.progress.map(s => {
                  // Keep settled active (spinner) if txHash hasn't arrived yet —
                  // the 'settled' SSE event arrives late and will mark it done.
                  if (s.key === 'settled' && !s.txHash) return { ...s, done: false, active: true };
                  return { ...s, done: true, active: false };
                }),
                progressUpdatedAt: Date.now()
              }
            : null;
          
          // Save to completed intents history
          const completedIntents = fulfilledIntent 
            ? { ...state.completedIntents, [fulfilledIntent.intentId]: fulfilledIntent }
            : state.completedIntents;
          
          return {
            activeIntent: fulfilledIntent,
            completedIntents
          };
        }),
      
      clearActiveIntent: () => set({ activeIntent: null }),
      
      getCompletedIntent: (intentId) => get().completedIntents[intentId],
    }),
    {
      name: 'naisu-active-intent',
    }
  )
);
