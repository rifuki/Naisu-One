import LiveProgressCard from '@/components/LiveProgressCard';
import { QuoteReviewWidget, BalanceDisplayWidget, DutchAuctionPlanWidget } from '../widgets';
import type { AnyWidget, WidgetConfirmPayload } from '../widgets';
import { IntentReceiptCard, extractReceiptData } from './intent-receipt-card';
import ReactMarkdown from 'react-markdown';
import { useTimeAgo } from '@/hooks/useTimeAgo';
import { formatAbsoluteTime } from '@/lib/time-utils';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
}

interface MessageBubbleProps {
  message: ChatMessage;
  renderContent: (content: string) => React.ReactNode;
  monitorTx?: { hash: string; chainId: number; userAddress: string; submittedAt: number } | null;
  onWidgetConfirm?: (payload: WidgetConfirmPayload) => void;
  onDutchPlanConfirm?: (intent: GaslessIntentData) => void;
}

interface TxInfo {
  hash: string;
  explorerBase: string;
}

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
  solverWarning?: string;
}

type ParsedWidget = { widget: GaslessIntentData; text: string; kind: 'gasless_intent' }
                  | { widget: AnyWidget; text: string; kind: 'quote_review' | 'balance_display' };

function extractTxHashFromSubmitMsg(content: string): TxInfo | null {
  const m = content.match(/Hash:\s*(0x[0-9a-fA-F]{64})/);
  const e = content.match(/Explorer:\s*(https?:\/\/\S+)/);
  if (m && e) {
    return { hash: m[1]!, explorerBase: e[1]!.replace(m[1]!, '') };
  }
  return null;
}

/**
 * Extract any typed widget JSON from a ```json ... ``` fenced code block.
 * Supports: gasless_intent, quote_review, balance_display
 */
function extractWidgetBlock(content: string): ParsedWidget | null {
  const match = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]!) as { type?: string };
    const text = content.replace(match[0]!, '').trim();

    if (parsed.type === 'gasless_intent') {
      return { widget: parsed as GaslessIntentData, text, kind: 'gasless_intent' };
    }
    if (parsed.type === 'quote_review') {
      return { widget: parsed as AnyWidget, text, kind: 'quote_review' };
    }
    if (parsed.type === 'balance_display') {
      return { widget: parsed as AnyWidget, text, kind: 'balance_display' };
    }
    return null;
  } catch {
    return null;
  }
}

const DEST_LABELS: Record<string, string> = {
  solana: 'Solana',
  sui:    'Sui',
};

const OUTPUT_TOKEN_LABELS: Record<string, string> = {
  sol:       'SOL',
  msol:      'mSOL',
  marginfi:  'marginfi SOL',
};

function formatLamports(lamports: string): string {
  try {
    const val = Number(BigInt(lamports)) / 1e9;
    return val.toFixed(4);
  } catch {
    return lamports;
  }
}

function shortenAddress(addr: string, head = 8, tail = 6): string {
  if (addr.length <= head + tail + 3) return addr;
  return `${addr.slice(0, head)}...${addr.slice(-tail)}`;
}

/** Action buttons row below message bubble (ChatGPT style) */
function MessageActions({ text, isUser = false }: { text: string; isUser?: boolean }) {
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className={`flex items-center gap-1 mt-1 ${isUser ? 'justify-end' : ''}`}>
      <button
        onClick={handleCopy}
        className="p-1.5 rounded-md text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-all"
        title="Copy"
      >
        <span className="material-symbols-outlined text-[16px]">content_copy</span>
      </button>
    </div>
  );
}

/** Message header with name and auto-updating timestamp */
function MessageHeader({ name, timestamp, isUser = false }: { name: string; timestamp?: number; isUser?: boolean }) {
  const timeAgo = useTimeAgo(timestamp);
  const absoluteTime = formatAbsoluteTime(timestamp);

  return (
    <div className={`flex items-center gap-2 mb-1 ${isUser ? 'justify-end' : ''}`}>
      <span className="text-[12px] font-semibold text-white">{name}</span>
      <span 
        className="text-[10px] text-slate-500" 
        title={absoluteTime || 'just now'}
      >
        {timeAgo}
      </span>
    </div>
  );
}

/** Clean visual summary card for gasless bridge intent — shown inline in chat after sign */
function GaslessIntentSummary({ intent, text, renderContent }: {
  intent: GaslessIntentData;
  text: string;
  renderContent: (content: string) => React.ReactNode;
}) {
  const destLabel    = DEST_LABELS[intent.destinationChain]    ?? intent.destinationChain;
  const tokenLabel   = OUTPUT_TOKEN_LABELS[intent.outputToken] ?? intent.outputToken.toUpperCase();
  const startSol     = formatLamports(intent.startPrice);
  const floorSol     = formatLamports(intent.floorPrice);
  const durationMin  = Math.round(intent.durationSeconds / 60);
  const recipient    = shortenAddress(intent.recipientAddress);

  return (
    <div className="flex flex-col gap-3">
      {/* Solver warning banner */}
      {intent.solverWarning && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-500/8 border border-amber-500/25">
          <span className="material-symbols-outlined text-amber-400 text-[15px] mt-0.5 shrink-0">warning</span>
          <p className="text-[11px] text-amber-300 leading-snug">{intent.solverWarning}</p>
        </div>
      )}

      {/* Intent summary card */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 overflow-hidden">
        {/* Top bar */}
        <div className="px-4 py-2.5 flex items-center gap-2 bg-primary/8 border-b border-primary/15">
          <span className="material-symbols-outlined text-primary text-[15px]">swap_horiz</span>
          <span className="text-[11px] font-bold text-primary uppercase tracking-[0.1em]">Gasless Bridge Intent</span>
        </div>

        {/* Amount row */}
        <div className="px-4 pt-3 pb-2 flex items-center gap-3">
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold text-white tabular-nums">{intent.amount}</span>
            <span className="text-sm text-slate-400">ETH</span>
          </div>
          <span className="material-symbols-outlined text-primary/60 text-[18px]">arrow_forward</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-bold text-primary">~{startSol}</span>
            <span className="text-sm text-primary/70">{tokenLabel}</span>
            <span className="text-xs text-slate-500">on {destLabel}</span>
          </div>
        </div>

        {/* Details grid */}
        <div className="px-4 pb-3 grid grid-cols-2 gap-2">
          {/* Recipient */}
          <div className="col-span-2 flex items-center justify-between py-1.5 px-3 rounded-lg bg-white/3 border border-white/6">
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-slate-500 text-[13px]">account_balance_wallet</span>
              <span className="text-[10px] text-slate-500 uppercase tracking-wider">To</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-mono text-slate-300">{recipient}</span>
              <button
                onClick={() => navigator.clipboard.writeText(intent.recipientAddress)}
                className="text-slate-600 hover:text-primary transition-colors"
                title={intent.recipientAddress}
              >
                <span className="material-symbols-outlined text-[11px]">content_copy</span>
              </button>
            </div>
          </div>

          {/* Best price */}
          <div className="flex flex-col gap-1 py-1.5 px-3 rounded-lg bg-white/3 border border-white/5">
            <span className="text-[9px] text-slate-600 uppercase tracking-wider">Best price</span>
            <span className="text-[11px] font-mono text-slate-200">{startSol} {tokenLabel}</span>
          </div>

          {/* Min receive — on-chain guaranteed */}
          <div className="flex flex-col gap-1 py-1.5 px-3 rounded-lg bg-green-500/5 border border-green-500/15">
            <div className="flex items-center gap-1">
              <span className="material-symbols-outlined text-green-500 text-[10px]">verified_user</span>
              <span className="text-[9px] text-green-600 uppercase tracking-wider">Min. receive</span>
            </div>
            <span className="text-[11px] font-mono text-green-400 font-semibold">{floorSol} {tokenLabel}</span>
          </div>

          {/* Auction duration */}
          <div className="flex flex-col gap-1 py-1.5 px-3 rounded-lg bg-white/3 border border-white/5">
            <span className="text-[9px] text-slate-600 uppercase tracking-wider">Auction</span>
            <span className="text-[11px] font-mono text-slate-200">{durationMin} min</span>
          </div>

          {/* Network fee */}
          <div className="flex flex-col gap-1 py-1.5 px-3 rounded-lg bg-green-500/5 border border-green-500/15">
            <span className="text-[9px] text-green-600 uppercase tracking-wider">Network fee</span>
            <span className="text-[11px] font-bold text-green-400">FREE <span className="font-normal text-green-600/70">(solver pays)</span></span>
          </div>
        </div>
      </div>

      {/* Remaining agent text */}
      {text && !/^sign the message above/i.test(text.trim()) && (
        <div className="text-slate-300 text-sm leading-relaxed">
          {renderContent(text)}
        </div>
      )}
    </div>
  );
}

export function MessageBubble({ message, renderContent, monitorTx, onWidgetConfirm, onDutchPlanConfirm }: MessageBubbleProps) {
  if (message.role === 'user') {
    // Hide system/widget-confirm messages from chat UI
    if (
      message.content.startsWith('[System]') ||
      message.content.startsWith('[Widget confirm]')
    ) return null;

    const txInfo = extractTxHashFromSubmitMsg(message.content);

    if (txInfo) {
      return (
        <div
          className="flex flex-col items-end gap-2 opacity-0 animate-fade-in-up"
          style={{ animationDelay: '0ms', animationFillMode: 'forwards' }}
        >
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-500/8 border border-indigo-500/15 text-xs font-mono text-slate-400">
            <span className="material-symbols-outlined text-indigo-400 text-[14px]">send</span>
            <span>
              Tx submitted · {txInfo.hash.slice(0, 10)}…{txInfo.hash.slice(-6)}
            </span>
            <a
              href={`${txInfo.explorerBase}${txInfo.hash}`}
              target="_blank"
              rel="noreferrer"
              className="text-slate-600 hover:text-primary transition-colors"
            >
              <span className="material-symbols-outlined text-[12px]">open_in_new</span>
            </a>
          </div>
        </div>
      );
    }

    return (
      <div
        className="group flex flex-col items-end gap-1 opacity-0 animate-fade-in-up"
        style={{ animationDelay: '0ms', animationFillMode: 'forwards' }}
      >
        <div className="max-w-2xl text-right">
          <MessageHeader name="You" timestamp={message.timestamp} isUser />
          <div className="inline-block p-4 rounded-2xl rounded-tr-none bg-indigo-500/10 border border-indigo-500/20 text-white text-sm leading-relaxed text-left shadow-lg">
            <p>{message.content}</p>
          </div>
          <MessageActions text={message.content} isUser />
        </div>
      </div>
    );
  }

  // Assistant message — parse widget blocks
  const parsed = extractWidgetBlock(message.content);
  
  // Check for receipt message
  const receiptData = extractReceiptData(message.content);
  if (receiptData) {
    return (
      <div
        className="group flex gap-3 opacity-0 animate-fade-in-up"
        style={{ animationDelay: '0ms', animationFillMode: 'forwards' }}
      >
        <div className="flex-shrink-0 mt-1 hidden sm:block">
          <div className="size-8 rounded-full bg-gradient-to-br from-primary/80 to-teal-800 flex items-center justify-center shadow-[0_0_16px_rgba(13,242,223,0.25)] ring-1 ring-primary/20">
            <span className="material-symbols-outlined text-white text-[16px]">smart_toy</span>
          </div>
        </div>
        <div className="flex-1 max-w-2xl">
          <MessageHeader name="Nesu" timestamp={message.timestamp} />
          <IntentReceiptCard data={receiptData} />
          <MessageActions text="Intent Receipt" />
        </div>
      </div>
    );
  }

  // For gasless_intent widget, show Dutch Auction Plan widget
  if (parsed?.kind === 'gasless_intent') {
    const intent = parsed.widget;
    
    return (
      <div
        className="group flex gap-3 opacity-0 animate-fade-in-up"
        style={{ animationDelay: '0ms', animationFillMode: 'forwards' }}
      >
        <div className="flex-shrink-0 mt-1 hidden sm:block">
          <div className="size-8 rounded-full bg-gradient-to-br from-primary/80 to-teal-800 flex items-center justify-center shadow-[0_0_16px_rgba(13,242,223,0.25)] ring-1 ring-primary/20">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m12.728 0l-.707.707M12 21v-1m0-16a9 9 0 110 18 9 9 0 010-18z" />
            </svg>
          </div>
        </div>
        <div className="flex-1 max-w-md">
          <MessageHeader name="Nesu" timestamp={message.timestamp} />
          <DutchAuctionPlanWidget
            amount={intent.amount}
            startPrice={intent.startPrice}
            floorPrice={intent.floorPrice}
            durationSeconds={intent.durationSeconds}
            destinationChain={intent.destinationChain}
            outputToken={intent.outputToken}
            recipientAddress={intent.recipientAddress}
            onConfirm={onDutchPlanConfirm ? (plan) => {
              // Update intent with selected plan
              onDutchPlanConfirm({
                ...intent,
                durationSeconds: plan.durationSeconds,
                startPrice: plan.startPrice,
              });
            } : undefined}
            isConfirmed={false}
          />
          <MessageActions text={`Dutch Auction Plan: ${intent.amount} ETH → ${intent.destinationChain}`} />
        </div>
      </div>
    );
  }

  return (
    <div
      className="group flex gap-3 opacity-0 animate-fade-in-up"
      style={{ animationDelay: '0ms', animationFillMode: 'forwards' }}
    >
      <div className="flex-shrink-0 mt-1 hidden sm:block">
        <div className="size-8 rounded-full bg-gradient-to-br from-primary/80 to-teal-800 flex items-center justify-center shadow-[0_0_16px_rgba(13,242,223,0.25)] ring-1 ring-primary/20">
          <span className="material-symbols-outlined text-white text-[16px]">smart_toy</span>
        </div>
      </div>
      <div className="flex-1 max-w-2xl">
        <MessageHeader name="Nesu" timestamp={message.timestamp} />
        <div className="px-4 py-3.5 rounded-2xl rounded-tl-none bg-[#0d1614] border border-white/6 text-slate-300 text-sm leading-relaxed shadow-lg">
          {parsed?.kind === 'quote_review' && (
            <div className="flex flex-col gap-3">
              <QuoteReviewWidget
                widget={parsed.widget as import('../widgets/types').QuoteReviewWidget}
                onConfirm={(outputToken, durationSeconds) => {
                  onWidgetConfirm?.({ widgetType: 'quote_review', selection: { outputToken, durationSeconds } });
                }}
              />
              {parsed.text && !/^\s*$/.test(parsed.text) && (
                <div className="text-slate-300 text-sm leading-relaxed">
                  {renderContent(parsed.text)}
                </div>
              )}
            </div>
          )}
          {parsed?.kind === 'balance_display' && (
            <div className="flex flex-col gap-3">
              <BalanceDisplayWidget widget={parsed.widget as import('../widgets/types').BalanceDisplayWidget} />
              {parsed.text && !/^\s*$/.test(parsed.text) && (
                <div className="text-slate-300 text-sm leading-relaxed">
                  {renderContent(parsed.text)}
                </div>
              )}
            </div>
          )}
          {!parsed && renderContent(message.content)}

          {monitorTx && (
            <div className="mt-4 border-t border-white/10 pt-3">
              <LiveProgressCard
                userAddress={monitorTx.userAddress}
                txHash={monitorTx.hash}
                submittedAt={monitorTx.submittedAt}
              />
              <div className="flex mt-2 justify-end">
                <a
                  href={`https://sepolia.basescan.org/tx/${monitorTx.hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-slate-500 hover:text-primary flex items-center gap-1 transition-colors"
                >
                  <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                  View on BaseScan
                </a>
              </div>
            </div>
          )}
        </div>
        <MessageActions text={message.content} />
      </div>
    </div>
  );
}
