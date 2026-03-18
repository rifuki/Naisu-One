import type { ChatSession } from '@/hooks/useChatSessions';

interface ChatSidebarProps {
  sessions: ChatSession[];
  activeSessionId: string;
  disabled?: boolean;
  onNewChat: () => void;
  onSwitchSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onOpenSettings: () => void;
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
  onNewChat,
  onSwitchSession,
  onDeleteSession,
  onOpenSettings,
}: ChatSidebarProps) {
  const { today, yesterday, older } = groupSessions(sessions);

  const SessionItem = ({ s }: { s: ChatSession }) => (
    <div
      className={`w-full flex items-center pr-1.5 rounded-lg transition-colors group ${
        s.id === activeSessionId
          ? 'bg-white/10 text-white'
          : `text-slate-400 ${disabled ? '' : 'hover:bg-white/5 hover:text-slate-200'} ${disabled ? 'opacity-50' : ''}`
      }`}
    >
      <button
        onClick={() => onSwitchSession(s.id)}
        disabled={disabled}
        title={s.title}
        className={`flex-1 flex items-center gap-2 px-2.5 py-2 overflow-hidden text-left ${disabled ? 'cursor-not-allowed' : ''}`}
      >
        <span className="material-symbols-outlined text-[15px] shrink-0 opacity-60">chat_bubble</span>
        <span className="text-xs font-medium truncate">{s.title}</span>
      </button>
      
      <button
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
      </button>
    </div>
  );

  const Section = ({ label, items }: { label: string; items: ChatSession[] }) =>
    items.length === 0 ? null : (
      <div className="mb-4">
        <div className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5 px-2">{label}</div>
        <div className="flex flex-col gap-0.5">
          {items.map(s => <SessionItem key={s.id} s={s} />)}
        </div>
      </div>
    );

  return (
    <div className="hidden md:flex flex-col w-[240px] h-full bg-[#070a09] border-r border-white/5 shrink-0">
      <div className="p-3 flex flex-col gap-3 flex-1 min-h-0">
        {/* New Chat Button */}
        <button
          onClick={onNewChat}
          disabled={disabled}
          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-colors border ${
            disabled
              ? 'bg-white/5 text-slate-200 border-white/5 opacity-50 cursor-not-allowed'
              : 'bg-white/5 hover:bg-white/10 text-slate-200 hover:text-white border-white/5 hover:border-white/10'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-sm">add</span>
            <span className="text-sm font-medium">New Chat</span>
          </div>
          <span className="material-symbols-outlined text-sm opacity-40">edit</span>
        </button>

        {/* Session List */}
        <div className="flex-1 overflow-y-auto pr-1 -mr-1">
          {sessions.length === 0 ? (
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
      <div className="p-3 border-t border-white/5 shrink-0">
        <button
          onClick={onOpenSettings}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
        >
          <div className="w-7 h-7 rounded-lg bg-surface border border-white/5 flex items-center justify-center">
            <span className="material-symbols-outlined text-sm">tune</span>
          </div>
          <span className="text-sm font-medium">Agent Settings</span>
        </button>
      </div>
    </div>
  );
}
