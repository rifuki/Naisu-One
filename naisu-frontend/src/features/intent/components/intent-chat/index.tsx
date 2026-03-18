import ReactMarkdown from 'react-markdown';
import { useState, FormEvent, KeyboardEvent } from 'react';
import { ChatMessage } from './message-bubble';
import { MessageList } from './message-list';
import { MessageInput } from './message-input';

interface IntentChatProps {
  messages: ChatMessage[];
  inputValue: string;
  isLoading: boolean;
  error: string | null;
  userAddress?: string | null;
  submittedTxs: Array<{ hash: string; chainId: number; msgIdx: number }>;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onRetry: () => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
}

function renderMarkdown(content: string) {
  return (
    <div
      className="prose prose-invert prose-sm max-w-none
      [&_table]:w-full [&_table]:text-xs [&_table]:border-collapse
      [&_td]:px-2 [&_td]:py-1.5 [&_td]:border [&_td]:border-white/10
      [&_th]:px-2 [&_th]:py-1.5 [&_th]:border [&_th]:border-white/10 [&_th]:bg-white/5 [&_th]:text-left
      [&_code]:bg-primary/10 [&_code]:px-1.5 [&_code]:rounded [&_code]:text-primary [&_code]:text-xs [&_code]:font-mono [&_code]:border [&_code]:border-primary/20
      [&_pre]:bg-slate-900/50 [&_pre]:border [&_pre]:border-white/10 [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:overflow-x-auto [&_pre]:text-xs
      [&_p]:my-2 [&_ul]:my-2 [&_li]:my-1 [&_strong]:text-white [&_a]:text-primary [&_a]:hover:underline
      [&_h1]:text-lg [&_h1]:font-bold [&_h1]:text-white [&_h1]:mb-2
      [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-white [&_h2]:mb-2
      [&_h3]:text-sm [&_h3]:font-bold [&_h3]:text-white [&_h3]:mb-1"
    >
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}

export function IntentChat({
  messages,
  inputValue,
  isLoading,
  error,
  userAddress,
  submittedTxs,
  onInputChange,
  onSend,
  onRetry,
  onNewChat,
  onOpenSettings,
}: IntentChatProps) {
  return (
    <div className="h-full flex flex-col bg-[#070a09] relative">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-8 py-4 border-b border-white/5 relative z-20">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center">
            <span className="material-symbols-outlined text-primary text-xl">auto_awesome</span>
          </div>
          <div>
            <h1 className="text-base font-bold text-white">NesuClaw Agent</h1>
            <p className="text-xs text-slate-500">AI-powered cross-chain intents</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onNewChat}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/5 hover:border-primary/30 hover:bg-white/10 transition-all text-slate-400 hover:text-white text-sm"
          >
            <span className="material-symbols-outlined text-sm">add</span>
            New Chat
          </button>
          <button
            onClick={onOpenSettings}
            className="p-2 rounded-full bg-white/5 border border-white/5 hover:border-primary/30 hover:bg-white/10 transition-all text-slate-400 hover:text-white"
          >
            <span className="material-symbols-outlined text-sm">tune</span>
          </button>
        </div>
      </div>

      {/* Messages */}
      <MessageList
        messages={messages}
        submittedTxs={submittedTxs}
        userAddress={userAddress}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        renderContent={renderMarkdown}
      />

      {/* Input */}
      <div className="w-full px-4 sm:px-8 pb-8 pt-4 relative z-20 bg-gradient-to-t from-background via-background to-transparent">
        <div className="max-w-3xl mx-auto">
          <MessageInput
            value={inputValue}
            onChange={onInputChange}
            onSubmit={onSend}
            isLoading={isLoading}
            placeholder="Type a follow-up..."
          />
          <div className="mt-2 text-center">
            <p className="text-[10px] text-slate-600">
              Powered by NesuClaw Agent. Verify critical transactions before executing.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export type { ChatMessage } from './message-bubble';
