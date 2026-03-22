/**
 * Chat Store - Global state for chat sessions
 * Using Zustand with persist middleware for localStorage sync
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  intentCount: number;
  fulfilledCount: number;
}

interface ChatState {
  sessions: ChatSession[];
  activeSessionId: string | null;
  
  // Actions
  createSession: () => string;
  setActiveSession: (sessionId: string) => void;
  addMessage: (sessionId: string, message: ChatMessage) => void;
  updateSessionTitle: (sessionId: string, title: string) => void;
  updateIntentCount: (sessionId: string, fulfilled: boolean) => void;
  deleteSession: (sessionId: string) => void;
  exportSessions: () => string;
  importSessions: (json: string) => boolean;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeSessionId: null,
      
      createSession: () => {
        const id = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        const newSession: ChatSession = {
          id,
          title: 'New Chat',
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          intentCount: 0,
          fulfilledCount: 0,
        };
        set((state) => ({
          sessions: [newSession, ...state.sessions],
          activeSessionId: id,
        }));
        return id;
      },
      
      setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),
      
      addMessage: (sessionId, message) =>
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  messages: [...s.messages, { ...message, timestamp: Date.now() }],
                  updatedAt: Date.now(),
                  title: s.title === 'New Chat' && s.messages.length === 0 && message.role === 'user'
                    ? message.content.slice(0, 30) + (message.content.length > 30 ? '...' : '')
                    : s.title,
                }
              : s
          ),
        })),
      
      updateSessionTitle: (sessionId, title) =>
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId ? { ...s, title } : s
          ),
        })),
      
      updateIntentCount: (sessionId, fulfilled) =>
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  intentCount: s.intentCount + 1,
                  fulfilledCount: fulfilled ? s.fulfilledCount + 1 : s.fulfilledCount,
                }
              : s
          ),
        })),
      
      deleteSession: (sessionId) =>
        set((state) => ({
          sessions: state.sessions.filter((s) => s.id !== sessionId),
          activeSessionId: state.activeSessionId === sessionId 
            ? (state.sessions.find((s) => s.id !== sessionId)?.id || null)
            : state.activeSessionId,
        })),
      
      exportSessions: () => JSON.stringify(get().sessions, null, 2),
      
      importSessions: (json) => {
        try {
          const sessions = JSON.parse(json) as ChatSession[];
          if (!Array.isArray(sessions)) return false;
          set({ sessions, activeSessionId: sessions[0]?.id || null });
          return true;
        } catch {
          return false;
        }
      },
    }),
    {
      name: 'naisu-chat-sessions',
      partialize: (state) => ({ sessions: state.sessions }),
    }
  )
);
