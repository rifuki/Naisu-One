import { ReactNode, useRef, useEffect } from 'react';
import { ChatMessage, MessageBubble } from './message-bubble';
import type { WidgetConfirmPayload } from '../widgets';

interface MessageListProps {
  messages: ChatMessage[];
  submittedTxs: Array<{ hash: string; chainId: number; msgIdx: number; submittedAt: number }>;
  userAddress?: string | null;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  renderContent: (content: string) => ReactNode;
  inlineCard?: ReactNode;
  onWidgetConfirm?: (payload: WidgetConfirmPayload) => void;
}

export function MessageList({
  messages,
  submittedTxs,
  userAddress,
  isLoading,
  error,
  onRetry,
  renderContent,
  inlineCard,
  onWidgetConfirm,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, isLoading, inlineCard]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto py-6 px-4 sm:px-8 space-y-6 flex flex-col items-center no-scrollbar relative z-10"
    >
      <div className="w-full max-w-3xl space-y-6">
        {messages.map((msg, idx) => {
          if (msg.role === 'user' && (msg.content.startsWith('[System]') || msg.content.startsWith('[Widget confirm]'))) return null;

          let monitorTx: { hash: string; chainId: number; userAddress: string; submittedAt: number } | null = null;

          if (msg.role === 'assistant' && submittedTxs.length > 0 && userAddress) {
            const match = submittedTxs.find((s) => s.msgIdx === idx);
            if (match) {
              monitorTx = {
                hash: match.hash,
                chainId: match.chainId,
                userAddress,
                submittedAt: match.submittedAt,
              };
            }
          }

          return (
            <MessageBubble
              key={idx}
              message={msg}
              renderContent={renderContent}
              monitorTx={monitorTx}
              onWidgetConfirm={onWidgetConfirm}
            />
          );
        })}

        {/* Inline intent progress card — appears after sign, replaces floating card */}
        {inlineCard}

        {/* Loading indicator */}
        {isLoading && (
          <div
            className="flex gap-3 opacity-0 animate-fade-in-up"
            style={{ animationDelay: '100ms', animationFillMode: 'forwards' }}
          >
            <div className="flex-shrink-0 mt-1 hidden sm:block">
              <div className="size-8 rounded-full bg-[#0d1614] border border-white/8 flex items-center justify-center">
                <div className="size-4 border-2 border-primary/60 border-t-transparent rounded-full animate-spin" />
              </div>
            </div>
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl rounded-tl-none bg-[#0d1614] border border-white/6">
              <div className="flex gap-1">
                <div
                  className="w-1.5 h-1.5 rounded-full bg-primary/50 animate-bounce"
                  style={{ animationDelay: '0ms' }}
                />
                <div
                  className="w-1.5 h-1.5 rounded-full bg-primary/50 animate-bounce"
                  style={{ animationDelay: '150ms' }}
                />
                <div
                  className="w-1.5 h-1.5 rounded-full bg-primary/50 animate-bounce"
                  style={{ animationDelay: '300ms' }}
                />
              </div>
              <p className="text-slate-500 text-[12px]">Thinking...</p>
            </div>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div
            className="flex gap-4 opacity-0 animate-fade-in-up"
            style={{ animationDelay: '0ms', animationFillMode: 'forwards' }}
          >
            <div className="flex-shrink-0 mt-2 hidden sm:block">
              <div className="size-10 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                <span className="material-symbols-outlined text-red-400 text-xl">error</span>
              </div>
            </div>
            <div className="flex-1 max-w-2xl">
              <div className="p-4 rounded-2xl rounded-tl-none bg-red-500/5 border border-red-500/20 text-red-300 text-sm leading-relaxed">
                <p className="font-medium mb-1">Failed to process intent</p>
                <p className="text-red-400/80 text-xs">{error}</p>
                {onRetry && (
                  <button
                    onClick={onRetry}
                    className="mt-3 px-4 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-300 text-xs font-medium transition-colors"
                  >
                    Retry
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
