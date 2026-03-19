import React, { createContext, useContext, ReactNode } from 'react';
import { useAccount } from 'wagmi';
import { useSolanaAddress } from '@/hooks/useSolanaAddress';
import { useChatSessions, type ChatSession, type ExportedData } from '@/hooks/useChatSessions';
import { useAgent, type AgentMessage, type TxData, type GaslessIntentData } from '@/hooks/useAgent';

interface AgentContextValue {
  sessions: ChatSession[];
  activeSessionId: string;
  activeSession: ChatSession | null;
  createSession: () => ChatSession;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;
  exportSessions: () => void;
  importSessions: (file: File) => Promise<{ success: boolean; count: number; error?: string }>;
  clearAllSessions: () => void;
  messages: AgentMessage[];
  isLoading: boolean;
  error: string | null;
  sendMessage: (msg: string) => Promise<void>;
  addMessage: (content: string, role?: 'assistant' | 'user') => void;
  pendingTx?: TxData;
  setPendingTx: (tx?: TxData) => void;
  pendingGaslessIntent?: GaslessIntentData;
  setPendingGaslessIntent: (intent?: GaslessIntentData) => void;
  updateIntentCount: (sessionId: string, fulfilled: boolean) => void;
}

const AgentContext = createContext<AgentContextValue | null>(null);

export function AgentProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const solanaAddress = useSolanaAddress();

  const {
    sessions,
    activeSessionId,
    activeSession,
    createSession,
    switchSession,
    updateActiveSession,
    deleteSession,
    exportSessions,
    importSessions,
    clearAllSessions,
    updateIntentCount,
  } = useChatSessions(address ?? 'guest');

  const {
    messages,
    isLoading,
    error,
    sendMessage,
    addMessage,
    pendingTx,
    setPendingTx,
    pendingGaslessIntent,
    setPendingGaslessIntent
  } = useAgent(
    address || 'anonymous',
    solanaAddress || '',
    {
      messages: activeSession?.messages ?? [],
      backendSessionId: activeSession?.backendSessionId,
      onMessagesChange: (msgs, backendSessionId) => {
        // Auto-generate title is now handled in useChatSessions.updateActiveSession
        updateActiveSession({ messages: msgs, backendSessionId });
      },
    }
  );

  return (
    <AgentContext.Provider 
      value={{
        sessions, activeSessionId, activeSession, createSession, switchSession, deleteSession,
        exportSessions, importSessions, clearAllSessions,
        messages, isLoading, error, sendMessage, addMessage, pendingTx, setPendingTx,
        pendingGaslessIntent, setPendingGaslessIntent,
        updateIntentCount,
      }}
    >
      {children}
    </AgentContext.Provider>
  );
}

export function useGlobalAgent() {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error('useGlobalAgent must be used within an AgentProvider');
  return ctx;
}
