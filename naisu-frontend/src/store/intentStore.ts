/**
 * Intent Store - Global state for active intent progress
 * Using Zustand for clean state management across components
 */
import { create } from 'zustand';

export interface ProgressStep {
  key: string;
  label: string;
  detail?: string;
  done: boolean;
  active: boolean;
}

export interface ActiveIntent {
  intentId: string;
  contractOrderId?: string;
  progress: ProgressStep[];
  isFulfilled: boolean;
  fillPrice?: string;
  winnerSolver?: string;
  signedAt?: number;
  fulfilledAt?: number;
}

interface IntentState {
  // Active intent being tracked
  activeIntent: ActiveIntent | null;
  
  // Actions
  setActiveIntent: (intent: ActiveIntent | null) => void;
  updateProgress: (progress: ProgressStep[]) => void;
  updateIntentId: (contractOrderId: string) => void;
  markFulfilled: (fillPrice?: string, winnerSolver?: string) => void;
  clearActiveIntent: () => void;
}

export const useIntentStore = create<IntentState>((set) => ({
  activeIntent: null,
  
  setActiveIntent: (intent) => set({ activeIntent: intent }),
  
  updateProgress: (progress) => 
    set((state) => ({
      activeIntent: state.activeIntent 
        ? { ...state.activeIntent, progress }
        : null
    })),
  
  updateIntentId: (contractOrderId) =>
    set((state) => ({
      activeIntent: state.activeIntent
        ? { ...state.activeIntent, contractOrderId }
        : null
    })),
  
  markFulfilled: (fillPrice, winnerSolver) =>
    set((state) => ({
      activeIntent: state.activeIntent
        ? {
            ...state.activeIntent,
            isFulfilled: true,
            fulfilledAt: Date.now(),
            fillPrice: fillPrice || state.activeIntent.fillPrice,
            winnerSolver: winnerSolver || state.activeIntent.winnerSolver,
            progress: state.activeIntent.progress.map(s => ({ ...s, done: true, active: false }))
          }
        : null
    })),
  
  clearActiveIntent: () => set({ activeIntent: null }),
}));
