import { useState, useCallback, useRef } from 'react';
import type { AgentMessage } from './useAgent';

export interface ChatSession {
  id: string;
  title: string;
  messages: AgentMessage[];
  backendSessionId?: string;
  createdAt: number;
  updatedAt: number;
  intentCount?: number;  // How many intents were signed in this session
  fulfilledCount?: number;  // How many were fulfilled
}

export interface ExportedData {
  version: number;
  exportedAt: string;
  walletAddress: string;
  sessions: ChatSession[];
}

/** Generate smart title from first user message */
function generateSmartTitle(messages: AgentMessage[]): string {
  if (messages.length === 0) return 'New Chat';
  
  // Find first user message
  const firstUser = messages.find(m => m.role === 'user');
  if (!firstUser) return 'New Chat';
  
  const content = firstUser.content.trim();
  
  // Check for intent patterns
  if (content.toLowerCase().includes('bridge')) {
    // Extract amount and destination
    const amountMatch = content.match(/(\d+\.?\d*)\s*(eth|sol|usdc|usdt)/i);
    const destMatch = content.match(/to\s+(solana|sui|base)/i);
    
    if (amountMatch && destMatch) {
      return `Bridge ${amountMatch[1]} ${amountMatch[2].toUpperCase()} → ${destMatch[1].charAt(0).toUpperCase() + destMatch[1].slice(1)}`;
    }
    return 'Bridge Intent';
  }
  
  if (content.toLowerCase().includes('swap')) {
    return 'Swap Request';
  }
  
  if (content.toLowerCase().includes('balance') || content.toLowerCase().includes('portfolio')) {
    return 'Balance Check';
  }
  
  if (content.toLowerCase().includes('earn') || content.toLowerCase().includes('stake')) {
    return 'Earn/Staking';
  }
  
  // Default: truncate first 30 chars
  return content.length > 30 ? content.slice(0, 30) + '…' : content;
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
  // Keep stable ref for functions that need latest state without dependency
  const sessionsRef = useRef<ChatSession[]>([]);

  const [sessions, setSessions] = useState<ChatSession[]>(() => loadSessions(sessionsKey));
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    const saved = localStorage.getItem(activeKey);
    const all   = loadSessions(sessionsKey);
    if (saved && all.find(s => s.id === saved)) return saved;
    return null;
  });

  // Keep activeSessionId in a stable ref to prevent closure staleness in callbacks
  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  // Sync ref
  sessionsRef.current = sessions;

  const activeSession = activeSessionId ? sessions.find(s => s.id === activeSessionId) ?? null : null;

  const persist = useCallback((next: ChatSession[]) => {
    setSessions(next);
    sessionsRef.current = next;
    saveSessions(sessionsKey, next);
  }, [sessionsKey]);

  /** Create a brand-new empty session and switch to it. */
  const createSession = useCallback((title: string = 'New Chat') => {
    const session: ChatSession = {
      id: generateId(), title,
      messages: [], createdAt: Date.now(), updatedAt: Date.now(),
      intentCount: 0, fulfilledCount: 0,
    };
    setSessions(prev => {
      const next = [...prev, session];
      saveSessions(sessionsKey, next);
      sessionsRef.current = next;
      return next;
    });
    setActiveSessionId(session.id);
    activeSessionIdRef.current = session.id;
    try { localStorage.setItem(activeKey, session.id); } catch { /* ignore */ }
    return session;
  }, [sessionsKey, activeKey]);

  /** Switch to an existing session or null for new virtual chat */
  const switchSession = useCallback((id: string | null) => {
    setActiveSessionId(id);
    if (id) {
      try { localStorage.setItem(activeKey, id); } catch { /* ignore */ }
    } else {
      try { localStorage.removeItem(activeKey); } catch { /* ignore */ }
    }
  }, [activeKey]);

  /** Update the active session's messages and auto-generate title from first user message */
  const updateActiveSession = useCallback((
    updates: Partial<Pick<ChatSession, 'messages' | 'backendSessionId' | 'title'>>
  ) => {
    // Read from stable ref
    let currentActiveId = activeSessionIdRef.current;
    
    if (!currentActiveId) {
      const session = createSession();
      currentActiveId = session.id;
    }
    
    setSessions(prev => {
      const current = prev.find(s => s.id === currentActiveId);
      const isNewSession = current && current.title === 'New Chat' && current.messages.length === 0;
      
      // Auto-generate title if this is first message in new session
      const newTitle = (isNewSession && updates.messages && updates.messages.length > 0)
        ? generateSmartTitle(updates.messages)
        : updates.title;
      
      const next = prev.map(s =>
        s.id === currentActiveId
          ? { ...s, ...updates, ...(newTitle ? { title: newTitle } : {}), updatedAt: Date.now() }
          : s
      );
      saveSessions(sessionsKey, next);
      sessionsRef.current = next;
      return next;
    });
  }, [sessionsKey]);

  /** Update intent counts for tracking stats */
  const updateIntentCount = useCallback((sessionId: string, fulfilled: boolean) => {
    setSessions(prev => {
      const next = prev.map(s =>
        s.id === sessionId
          ? { 
              ...s, 
              intentCount: (s.intentCount || 0) + 1,
              fulfilledCount: (s.fulfilledCount || 0) + (fulfilled ? 1 : 0),
              updatedAt: Date.now(),
            }
          : s
      );
      saveSessions(sessionsKey, next);
      return next;
    });
  }, [sessionsKey]);

  /** Delete a session; switches to new virtual chat if active deleted */
  const deleteSession = useCallback((id: string) => {
    let next = sessionsRef.current.filter(s => s.id !== id);

    sessionsRef.current = next;
    saveSessions(sessionsKey, next);
    setSessions(next);

    if (activeSessionIdRef.current === id || activeSessionId === id) {
      switchSession(null);
    }
  }, [activeSessionId, sessionsKey, switchSession]);

  /** Export all sessions to JSON file */
  const exportSessions = useCallback(() => {
    const data: ExportedData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      walletAddress,
      sessions: sessionsRef.current,
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `naisu-chat-backup-${walletAddress.slice(0, 6)}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [walletAddress]);

  /** Import sessions from JSON file */
  const importSessions = useCallback((file: File): Promise<{ success: boolean; count: number; error?: string }> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data: ExportedData = JSON.parse(e.target?.result as string);
          
          // Validate
          if (!data.sessions || !Array.isArray(data.sessions)) {
            resolve({ success: false, count: 0, error: 'Invalid backup file format' });
            return;
          }
          
          // Merge with existing (avoid duplicates by id)
          const existingIds = new Set(sessionsRef.current.map(s => s.id));
          const newSessions = data.sessions.filter(s => !existingIds.has(s.id));
          
          if (newSessions.length === 0) {
            resolve({ success: true, count: 0, error: 'No new sessions to import' });
            return;
          }
          
          const merged = [...sessionsRef.current, ...newSessions];
          persist(merged);
          resolve({ success: true, count: newSessions.length });
        } catch (err) {
          resolve({ success: false, count: 0, error: 'Failed to parse backup file' });
        }
      };
      reader.onerror = () => resolve({ success: false, count: 0, error: 'Failed to read file' });
      reader.readAsText(file);
    });
  }, [persist]);

  /** Clear all sessions (dangerous!) */
  const clearAllSessions = useCallback(() => {
    persist([]);
    switchSession(null);
  }, [persist, switchSession]);

  return {
    sessions,
    activeSessionId,
    activeSession,
    createSession,
    switchSession,
    updateActiveSession,
    updateIntentCount,
    deleteSession,
    exportSessions,
    importSessions,
    clearAllSessions,
  };
}
