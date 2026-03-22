import { type ReactNode, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { ChatMessage } from './message-bubble';
import { MessageList } from './message-list';
import { MessageInput } from './message-input';
import type { SignIntentParams } from '../../hooks/use-sign-intent';

const SUGGESTIONS = [
  'Bridge 0.001 ETH from Base Sepolia to Solana',
  'How much SOL will I get for 0.1 ETH?',
  'Check my portfolio across chains',
];

interface GaslessIntentData {
  type: 'gasless_intent';
  recipientAddress: string;
  destinationChain: string;
  amount: string;
  outputToken: string;
  startPrice: string;
  floorPrice: string;
  durationSeconds: number;
  nonce: number;
}

interface IntentChatProps {
  messages: ChatMessage[];
  inputValue: string;
  isLoading: boolean;
  error: string | null;
  userAddress?: string | null;
  submittedTxs: Array<{ hash: string; chainId: number; msgIdx: number; submittedAt: number }>;
  onInputChange: (value: string) => void;
  onSend: (overrideText?: string) => void;
  onRetry: () => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onDutchPlanConfirm?: (intent: GaslessIntentData) => void;
  // Sign intent card props (rendered inline in chat instead of floating)
  pendingSignIntent?: SignIntentParams | null;
  signIntentStatus?: string | null;
  isSignIntentFailed?: boolean;
  isSignIntentSuccess?: boolean;
  onSignIntentConfirm?: () => void;
  onSignIntentDismiss?: () => void;
}

/**
 * Fix malformed markdown tables from AI responses.
 * Converts double-pipe tables (||) to standard single-pipe (|) format.
 */
function sanitizeMarkdownTables(content: string): string {
  // Fix double-pipe table format: || Amount || Value || -> | Amount | Value |
  // Handle cases like: || Amount ||--|--|| Your 0.1 ETH | ~$300 USD ||
  let sanitized = content;
  
  // Replace || at start of line with | 
  sanitized = sanitized.replace(/^\|\|/gm, '|');
  // Replace || at end of line with |
  sanitized = sanitized.replace(/\|\|$/gm, '|');
  // Replace || in middle with |
  sanitized = sanitized.replace(/\|\|\s*\|\|/g, ' | ');
  sanitized = sanitized.replace(/\|\|/g, '|');
  
  // Fix malformed separator lines like |--|--| -> |---|---|
  sanitized = sanitized.replace(/\|(--)+\|/g, (match) => {
    return match.replace(/--/g, '---');
  });
  
  return sanitized;
}

function renderMarkdown(content: string) {
  const sanitizedContent = sanitizeMarkdownTables(content);
  
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
      <ReactMarkdown>{sanitizedContent}</ReactMarkdown>
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
  onDutchPlanConfirm,
  pendingSignIntent,
  signIntentStatus,
  isSignIntentFailed,
  isSignIntentSuccess,
  onSignIntentConfirm,
  onSignIntentDismiss,
}: IntentChatProps) {
  const isEmpty = messages.length === 0 && !isLoading && !pendingSignIntent;
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSuggestionClick = (text: string) => {
    onInputChange(text);
    inputRef.current?.focus();
  };

  return (
    <div className="flex-1 flex flex-col bg-[#070a09] relative overflow-hidden">
      {/* Messages */}
      <MessageList
        messages={messages}
        submittedTxs={submittedTxs}
        userAddress={userAddress}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        renderContent={renderMarkdown}
        onDutchPlanConfirm={onDutchPlanConfirm}
        pendingSignIntent={pendingSignIntent}
        signIntentStatus={signIntentStatus}
        isSignIntentFailed={isSignIntentFailed}
        isSignIntentSuccess={isSignIntentSuccess}
        onSignIntentConfirm={onSignIntentConfirm}
        onSignIntentDismiss={onSignIntentDismiss}
      />

      {/* Input area */}
      <div className="w-full px-4 sm:px-8 pb-6 pt-3 relative z-20 shrink-0">
        <div className="max-w-3xl mx-auto opacity-0 animate-fade-in-up" style={{ animationFillMode: 'forwards' }}>
          {/* Suggestion chips — only when chat is empty and user hasn't typed */}
          {isEmpty && !inputValue.trim() && (
            <div className="flex flex-wrap items-center justify-center gap-2 mb-4">
              {SUGGESTIONS.map((text, i) => (
                <Button
                  key={text}
                  onClick={() => handleSuggestionClick(text)}
                  className="px-3.5 py-1.5 rounded-full bg-[#0A0A0A]/80 border border-white/10 hover:bg-white/10 hover:border-white/20 text-slate-300 hover:text-white text-[13px] font-medium shadow-md opacity-0 animate-fade-in-up hover:scale-105 active:scale-95 transition-all duration-200"
                  style={{ animationDelay: `${(i + 1) * 100}ms`, animationFillMode: 'forwards' }}
                >
                  {text}
                </Button>
              ))}
            </div>
          )}

          <MessageInput
            ref={inputRef}
            value={inputValue}
            onChange={onInputChange}
            onSubmit={onSend}
            isLoading={isLoading}
            placeholder={isEmpty ? 'Message Nesu...' : 'Type a follow-up...'}
          />
        </div>
      </div>
    </div>
  );
}

export type { ChatMessage } from './message-bubble';
