import ReactMarkdown from 'react-markdown';
import { ChatMessage } from './message-bubble';
import { MessageList } from './message-list';
import { MessageInput } from './message-input';

const SUGGESTIONS = [
  'Bridge 0.1 ETH from Base Sepolia to Solana',
  'Bridge 0.001 ETH from Base Sepolia to Solana',
  'How much SOL will I get for 0.1 ETH?',
  'Check my portfolio across chains',
];

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
  const isEmpty = messages.length === 0 && !isLoading;

  const handleSuggestionClick = (text: string) => {
    onSend(text);
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
      />

      {/* Input area */}
      <div className="w-full px-4 sm:px-8 pb-6 pt-3 relative z-20 bg-background/80 backdrop-blur shrink-0 border-t border-white/5">
        <div className="max-w-3xl mx-auto">
          {/* Suggestion chips — only when chat is empty */}
          {isEmpty && (
            <div className="flex flex-wrap gap-2 mb-3">
              {SUGGESTIONS.map((text) => (
                <button
                  key={text}
                  onClick={() => handleSuggestionClick(text)}
                  className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-slate-400 hover:text-white text-xs font-medium transition-all hover:-translate-y-0.5"
                >
                  {text}
                </button>
              ))}
            </div>
          )}

          <MessageInput
            value={inputValue}
            onChange={onInputChange}
            onSubmit={onSend}
            isLoading={isLoading}
            placeholder={isEmpty ? 'Ask anything about DeFi...' : 'Type a follow-up...'}
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
