import { useState, useCallback } from 'react';
import type { AgentMessage } from './useAgent';

export interface ChatSession {
  id: string;
  title: string;
  messages: AgentMessage[];
  backendSessionId?: string;
  createdAt: number;
  updatedAt: number;
}

const SESSIONS_KEY = (addr: string) => `naisu_sessions_${addr}`;
const ACTIVE_KEY   = (addr: string) => `naisu_active_${addr}`;

function generateId() {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function loadSessions(key: string): ChatSession[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSessions(key: string, sessions: ChatSession[]) {
  try { localStorage.setItem(key, JSON.stringify(sessions)); } catch { /* quota */ }
}

function initSessions(key: string): ChatSession[] {
  const all = loadSessions(key);
  if (all.length > 0) return all;
  const first: ChatSession = {
    id: generateId(),
    title: 'New Chat',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  saveSessions(key, [first]);
  return [first];
}

export function useChatSessions(walletAddress: string) {
  const sessionsKey = SESSIONS_KEY(walletAddress);
  const activeKey   = ACTIVE_KEY(walletAddress);

  const [sessions, setSessions] = useState<ChatSession[]>(() => initSessions(sessionsKey));
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    const saved = localStorage.getItem(activeKey);
    const all   = initSessions(sessionsKey);
    if (saved && all.find(s => s.id === saved)) return saved;
    return all[all.length - 1].id;
  });

  const activeSession = sessions.find(s => s.id === activeSessionId) ?? null;

  const persist = useCallback((next: ChatSession[]) => {
    setSessions(next);
    saveSessions(sessionsKey, next);
  }, [sessionsKey]);

  /** Create a brand-new empty session and switch to it */
  const createSession = useCallback(() => {
    const session: ChatSession = {
      id: generateId(), title: 'New Chat',
      messages: [], createdAt: Date.now(), updatedAt: Date.now(),
    };
    setSessions(prev => {
      const next = [...prev, session];
      saveSessions(sessionsKey, next);
      return next;
    });
    setActiveSessionId(session.id);
    try { localStorage.setItem(activeKey, session.id); } catch { /* ignore */ }
    return session;
  }, [sessionsKey, activeKey]);

  /** Switch to an existing session */
  const switchSession = useCallback((id: string) => {
    setActiveSessionId(id);
    try { localStorage.setItem(activeKey, id); } catch { /* ignore */ }
  }, [activeKey]);

  /** Update the active session's messages and optionally its title */
  const updateActiveSession = useCallback((
    updates: Partial<Pick<ChatSession, 'messages' | 'backendSessionId' | 'title'>>
  ) => {
    setSessions(prev => {
      const next = prev.map(s =>
        s.id === activeSessionId
          ? { ...s, ...updates, updatedAt: Date.now() }
          : s
      );
      saveSessions(sessionsKey, next);
      return next;
    });
  }, [activeSessionId, sessionsKey]);

  /** Delete a session; switches to the previous one or creates a new one */
  const deleteSession = useCallback((id: string) => {
    setSessions(prev => {
      let next = prev.filter(s => s.id !== id);
      
      // Prevent sessions from becoming fully empty
      if (next.length === 0) {
        const fallback: ChatSession = {
          id: generateId(), title: 'New Chat',
          messages: [], createdAt: Date.now(), updatedAt: Date.now(),
        };
        next = [fallback];
      }
      
      saveSessions(sessionsKey, next);
      
      if (activeSessionId === id && next.length > 0) {
        const fallback = next[next.length - 1];
        setActiveSessionId(fallback.id);
        try { localStorage.setItem(activeKey, fallback.id); } catch { /* ignore */ }
      }
      return next;
    });
  }, [activeSessionId, sessionsKey, activeKey]);

  return {
    sessions,
    activeSessionId,
    activeSession,
    createSession,
    switchSession,
    updateActiveSession,
    deleteSession,
  };
}
