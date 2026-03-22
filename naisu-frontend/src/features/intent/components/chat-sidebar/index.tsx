import React from 'react';
import { Plus, MessageSquarePlus, PanelLeftClose } from 'lucide-react';
import type { ChatSession } from '@/hooks/use-chat-sessions';
import { Button } from '@/components/ui/button';

interface ChatSidebarProps {
  sessions: ChatSession[];
  activeSessionId: string;
  disabled?: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onNewChat: () => void;
  onSwitchSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onOpenSettings: () => void;
  onExport?: () => void;
  onImport?: (file: File) => Promise<{ success: boolean; count: number; error?: string }>;
  onClearAll?: () => void;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function groupSessions(sessions: ChatSession[]) {
  const today: ChatSession[] = [];
  const yesterday: ChatSession[] = [];
  const older: ChatSession[] = [];
  const now = Date.now();
  for (const s of [...sessions].reverse()) {
    const diff = now - s.updatedAt;
    if (diff < 86_400_000) today.push(s);
    else if (diff < 172_800_000) yesterday.push(s);
    else older.push(s);
  }
  return { today, yesterday, older };
}

export function ChatSidebar({
  sessions,
  activeSessionId,
  disabled,
  isOpen,
  onToggle,
  onNewChat,
  onSwitchSession,
  onDeleteSession,
  onOpenSettings,
  onExport,
  onImport,
  onClearAll,
}: ChatSidebarProps) {
  // Only list sessions that have at least one message — empty sessions are "virtual new chat"
  // state and should not appear in history or be deletable by the user.
  const visibleSessions = sessions.filter(s => (s.messages?.length ?? 0) > 0);
  const { today, yesterday, older } = groupSessions(visibleSessions);

  // "New Chat" button is visually selected when the active session is empty
  const activeIsEmpty = !sessions.find(s => s.id === activeSessionId)?.messages?.length;

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const SessionItem = ({ s }: { s: ChatSession }) => {
    const hasIntents = (s.intentCount || 0) > 0;
    const allFulfilled = hasIntents && (s.fulfilledCount || 0) >= (s.intentCount || 0);
    
    return (
      <div
        className={`w-full flex items-center pr-1.5 rounded-lg transition-colors group ${
          s.id === activeSessionId
            ? 'bg-white/10 text-white'
            : `text-slate-400 ${disabled ? '' : 'hover:bg-white/5 hover:text-slate-200'} ${disabled ? 'opacity-50' : ''}`
        }`}
      >
        <Button
          variant="ghost"
          size="auto"
          onClick={() => onSwitchSession(s.id)}
          disabled={disabled}
          title={`${s.title}${hasIntents ? ` • ${s.intentCount} intent${s.intentCount !== 1 ? 's' : ''}` : ''}`}
          className={`flex-1 flex items-center gap-2 px-2.5 py-2 overflow-hidden text-left ${disabled ? 'cursor-not-allowed' : ''}`}
        >
          <span className="material-symbols-outlined text-[15px] shrink-0 opacity-60">chat_bubble</span>
          <span className="text-xs font-medium truncate flex-1">{s.title}</span>
          
          {/* Intent count badge */}
          {hasIntents && (
            <span 
              className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded-full ${
                allFulfilled 
                  ? 'bg-green-500/20 text-green-400' 
                  : 'bg-primary/20 text-primary'
              }`}
              title={`${s.fulfilledCount || 0}/${s.intentCount || 0} fulfilled`}
            >
              {s.intentCount}
            </span>
          )}
        </Button>
        
        <Button
          variant="ghost"
          size="auto"
          onClick={(e) => {
            e.stopPropagation();
            onDeleteSession(s.id);
          }}
          disabled={disabled}
          title="Delete chat"
          className={`p-1.5 transition-all shrink-0 flex items-center justify-center rounded-md ${
            disabled 
              ? 'opacity-0 text-slate-500 cursor-not-allowed' 
              : 'opacity-0 group-hover:opacity-100 hover:bg-red-500/20 hover:text-red-400 text-slate-500'
          }`}
        >
          <span className="material-symbols-outlined text-[14px]">delete</span>
        </Button>
      </div>
    );
  };

  const Section = ({ label, items }: { label: string; items: ChatSession[] }) =>
    items.length === 0 ? null : (
      <div className="mb-4">
        <div className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5 px-2">{label}</div>
        <div className="flex flex-col gap-0.5">
          {items.map(s => <SessionItem key={s.id} s={s} />)}
        </div>
      </div>
    );

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onImport) return;
    
    const result = await onImport(file);
    if (result.success) {
      alert(result.count > 0 ? `Imported ${result.count} sessions` : 'No new sessions to import');
    } else {
      alert(`Import failed: ${result.error}`);
    }
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className={`hidden md:flex flex-col h-full bg-[#070a09] border-r border-white/5 shrink-0 transition-[width,opacity,margin] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] overflow-hidden ${isOpen ? 'w-[240px] opacity-100' : 'w-0 opacity-0 border-none'}`}>
      <div className="p-3 flex flex-col gap-3 flex-1 min-h-0 min-w-[240px]">
        <div className="flex items-center gap-2">
          {/* Collapse Sidebar Button */}
          <Button
            variant="ghost"
            size="auto"
            onClick={onToggle}
            className="p-2.5 rounded-lg bg-transparent hover:bg-white/10 text-slate-400 hover:text-white transition-colors border border-transparent hover:border-white/5 shrink-0"
            title="Close sidebar"
          >
            <PanelLeftClose strokeWidth={2} className="w-[18px] h-[18px]" />
          </Button>

          {/* New Chat Button — Sleek & Minimalist */}
          <Button
            variant="ghost"
            size="auto"
            onClick={onNewChat}
            disabled={disabled}
            className={`flex-1 flex items-center justify-center px-3 py-2 rounded-lg transition-colors border border-transparent ${
              disabled
                ? 'opacity-50 cursor-not-allowed text-slate-500'
                : activeIsEmpty
                ? 'bg-white/10 text-white'
                : 'bg-transparent hover:bg-white/5 text-slate-300 hover:text-white'
            }`}
          >
            <div className="flex items-center gap-2">
              <Plus className="w-4 h-4" strokeWidth={2} />
              <span className="text-[13px] font-medium tracking-wide">New Chat</span>
            </div>
          </Button>
        </div>

        {/* Session List — only shows sessions with at least one message */}
        <div className="flex-1 overflow-y-auto pr-1 -mr-1">
          {visibleSessions.length === 0 ? (
            <p className="text-xs text-slate-600 px-2 py-4 text-center">No chats yet</p>
          ) : (
            <>
              <Section label="Today" items={today} />
              <Section label="Yesterday" items={yesterday} />
              <Section label="Older" items={older} />
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-white/5 shrink-0 flex flex-col gap-2">
        <Button
          variant="ghost"
          size="auto"
          onClick={onOpenSettings}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
        >
          <div className="w-7 h-7 rounded-lg bg-surface border border-white/5 flex items-center justify-center">
            <span className="material-symbols-outlined text-sm">tune</span>
          </div>
          <span className="text-sm font-medium">Agent Settings</span>
        </Button>
        
        {/* Export/Import buttons */}
        <div className="flex items-center gap-2">
          {onExport && (
            <Button
              variant="ghost"
              size="auto"
              onClick={onExport}
              title="Export all chats"
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white text-xs transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">download</span>
              Export
            </Button>
          )}
          {onImport && (
            <>
              <Button
                variant="ghost"
                size="auto"
                onClick={() => fileInputRef.current?.click()}
                title="Import chats"
                className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white text-xs transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">upload</span>
                Import
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleImport}
                className="hidden"
              />
            </>
          )}
          {onClearAll && visibleSessions.length > 0 && (
            <Button
              variant="ghost"
              size="auto"
              onClick={() => {
                if (confirm('Clear ALL chat history? This cannot be undone.')) {
                  onClearAll();
                }
              }}
              title="Clear all"
              className="flex items-center justify-center px-2 py-1.5 rounded-lg bg-white/5 hover:bg-red-500/20 text-slate-500 hover:text-red-400 text-xs transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">delete_sweep</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
