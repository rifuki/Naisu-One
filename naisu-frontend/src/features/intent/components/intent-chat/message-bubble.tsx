import { useState, useEffect } from 'react';

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.trim() || 'http://localhost:3000';

/** Fetch ETH and destination-token USD prices from backend quote endpoint */
function usePythPrices(
  amount: string,
  destinationChain: string,
  fromUsdProp: number | null | undefined,
  toUsdProp: number | null | undefined,
) {
  const [fromUsd, setFromUsd] = useState<number | null>(fromUsdProp ?? null);
  const [toUsd, setToUsd]   = useState<number | null>(toUsdProp ?? null);

  useEffect(() => {
    // If props already have data, use them and skip fetch
    if (fromUsdProp != null && toUsdProp != null) {
      setFromUsd(fromUsdProp);
      setToUsd(toUsdProp);
      return;
    }
    const toChain = destinationChain === 'solana' ? 'solana' : 'sui';
    const ac = new AbortController();
    fetch(
      `${BACKEND_URL}/api/v1/intent/quote?fromChain=evm-base&toChain=${toChain}&token=native&amount=${amount}`,
      { signal: ac.signal },
    )
      .then(r => r.json())
      .then((data: { success?: boolean; data?: { fromUsd?: number | null; toUsd?: number | null } }) => {
        if (data.success && data.data) {
          setFromUsd(data.data.fromUsd ?? null);
          setToUsd(data.data.toUsd ?? null);
        }
      })
      .catch(() => { /* silent — USD display is non-critical */ });
    return () => ac.abort();
  }, [amount, destinationChain, fromUsdProp, toUsdProp]);

  return { fromUsd, toUsd };
}
import { Zap, ShieldCheck, ArrowRight, Clock, SlidersHorizontal, CheckCircle2, Radio, Trophy, Link, Send, Shield, Sparkles } from 'lucide-react';
import LiveProgressCard from '@/components/LiveProgressCard';
import { BalanceDisplayWidget } from '../widgets';
import type { AnyWidget } from '../widgets';
import { IntentReceiptCard, extractReceiptData } from './intent-receipt-card';
import { useIntentStore } from '@/store';
import ReactMarkdown from 'react-markdown';
import { useTimeAgo } from '@/hooks/useTimeAgo';
import { formatAbsoluteTime } from '@/lib/time-utils';
import type { SignIntentParams } from '../../hooks/use-sign-intent';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
}

interface MessageBubbleProps {
  message: ChatMessage;
  renderContent: (content: string) => React.ReactNode;
  monitorTx?: { hash: string; chainId: number; userAddress: string; submittedAt: number } | null;
  onDutchPlanConfirm?: (intent: GaslessIntentData) => void;
  // For unified card flow
  pendingSignIntent?: SignIntentParams | null;
  signIntentStatus?: string | null;
  isSignIntentFailed?: boolean;
  isSignIntentSuccess?: boolean;
  onSignIntentConfirm?: () => void;
  onSignIntentDismiss?: () => void;
  isHistoricalIntent?: boolean;
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
  fromUsd?: number | null;
  toUsd?: number | null;
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


export function MessageBubble({
  message, renderContent, monitorTx, onDutchPlanConfirm,
  pendingSignIntent, signIntentStatus, isSignIntentFailed, isSignIntentSuccess,
  onSignIntentConfirm, onSignIntentDismiss, isHistoricalIntent
}: MessageBubbleProps) {
  // Must be before any early returns (React rules of hooks)
  const hasActiveIntent = useIntentStore((state) => !!state.activeIntent);

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
  
  // Check for receipt message — suppress entirely if UnifiedIntentBubble is handling tracking
  const receiptData = extractReceiptData(message.content);
  if (receiptData) {
    // Suppress when UnifiedIntentBubble is handling this specific intent.
    // 1. Module-level flag: live flow (same render cycle)
    // 2. Zustand store: post-refresh with live data
    // 3. localStorage phaseKey: historical sessions where Zustand was cleared but
    //    this intent's bubble previously saved its tracking state
    const receiptNonce = (receiptData.intent as { nonce?: number }).nonce;
    const receiptPhaseKey = receiptNonce != null
      ? `naisu_phase_${receiptData.intent.recipientAddress}_${receiptNonce}`
      : null;
    const isTrackedByBubble = (() => {
      try { return receiptPhaseKey ? localStorage.getItem(receiptPhaseKey) !== null : false; }
      catch { return false; }
    })();
    if (isBubbleTracking() || hasActiveIntent || isTrackedByBubble) return null;
    // Otherwise render the standalone receipt card
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
        <div className="flex-1 min-w-0">
          <MessageHeader name="Nesu" timestamp={message.timestamp} />
          <IntentReceiptCard data={receiptData} />
          <MessageActions text="Intent Receipt" />
        </div>
      </div>
    );
  }

  // quote_review widget is retired — always show as expired badge regardless of history
  if (parsed?.kind === 'quote_review') {
    return (
      <div className="group flex gap-3 opacity-0 animate-fade-in-up" style={{ animationDelay: '0ms', animationFillMode: 'forwards' }}>
        <div className="flex-shrink-0 mt-1 hidden sm:block">
          <div className="size-8 rounded-full bg-[#0a100f] border border-white/5 flex items-center justify-center grayscale opacity-50">
            <span className="material-symbols-outlined text-white text-[16px]">smart_toy</span>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <MessageHeader name="Nesu" timestamp={message.timestamp} />
          <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[#0a100f] border border-white/5 text-slate-500 text-xs font-mono shadow-sm">
            <span className="material-symbols-outlined text-[14px]">history</span>
            <span>Quote expired</span>
          </div>
        </div>
      </div>
    );
  }

  // For gasless_intent widget, unified card with internal phase state
  if (parsed?.kind === 'gasless_intent') {
    return (
      <UnifiedIntentBubble
        intent={parsed.widget}
        onSignIntent={onSignIntentConfirm}
        signStatus={signIntentStatus}
        isSignFailed={isSignIntentFailed}
        onDutchPlanConfirm={onDutchPlanConfirm}
        isHistoricalIntent={isHistoricalIntent}
      />
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


const DURATION_OPTIONS_BUBBLE = [
  { label: '2 min', seconds: 120 },
  { label: '5 min', seconds: 300 },
  { label: '10 min', seconds: 600 },
];

const SLIPPAGE_OPTIONS = [
  { label: '5%',  pct: 5,  hint: 'Slower fill' },
  { label: '10%', pct: 10, hint: 'Balanced' },
  { label: '20%', pct: 20, hint: 'Fastest fill' },
];

function TxReceiptRow({
  label, badge, badgeClass, hash, href, copiedKey, copyKey, onCopy,
}: {
  label: string; badge: string; badgeClass: string; hash: string; href: string;
  copiedKey: string | null; copyKey: string; onCopy: () => void;
}) {
  return (
    <div className="px-2.5 py-1.5 flex items-center gap-2 border-t border-white/5 first:border-0">
      <div className={`size-4 rounded-full border flex items-center justify-center shrink-0 ${badgeClass}`}>
        <span className="text-[7px] font-bold">{badge}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[7.5px] text-slate-700 leading-none mb-0.5">{label}</div>
        <div className="font-mono text-[9px] text-slate-400 truncate">{`${hash.slice(0, 12)}…${hash.slice(-6)}`}</div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <a href={href} target="_blank" rel="noreferrer" className="text-slate-700 hover:text-[#0df2df] transition-colors">
          <span className="material-symbols-outlined text-[11px]">open_in_new</span>
        </a>
        <button onClick={onCopy} className="text-slate-700 hover:text-slate-400 transition-colors"
          title={copiedKey === copyKey ? 'Copied!' : 'Copy'}>
          <span className="material-symbols-outlined text-[11px]">
            {copiedKey === copyKey ? 'check' : 'content_copy'}
          </span>
        </button>
      </div>
    </div>
  );
}

// Module-level flag: when a UnifiedIntentBubble is in tracking phase,
// MessageBubble skips rendering the separate receipt card to avoid duplication.
let _bubbleTracking = false;
const setBubbleTracking = (v: boolean) => { _bubbleTracking = v; };
const isBubbleTracking = () => _bubbleTracking;

// Internal component for unified intent flow with phase state
interface UnifiedIntentBubbleProps {
  intent: GaslessIntentData;
  onSignIntent?: () => void;
  signStatus?: string | null;  // Error/status message from parent
  isSignFailed?: boolean;      // True when signing failed (MetaMask cancel, etc.)
  onDutchPlanConfirm?: (intent: GaslessIntentData) => void;
  isHistoricalIntent?: boolean;
}

function UnifiedIntentBubble({ intent, onSignIntent, signStatus, isSignFailed, onDutchPlanConfirm, isHistoricalIntent }: UnifiedIntentBubbleProps) {
  // Stable key per intent (nonce is unique per address per submission).
  // Used to persist phase state in localStorage — survives refresh and navigation.
  const phaseKey = `naisu_phase_${intent.recipientAddress}_${intent.nonce}`;

  // Phase init: read from localStorage keyed by this specific intent's nonce.
  // This correctly handles: refresh (same intent keeps tracking), new bridge request
  // in same session (new nonce → no key → starts in plan), historical sessions.
  const [phase, setPhase] = useState<'plan' | 'sign' | 'tracking' | 'done'>(() => {
    try {
      const raw = localStorage.getItem(`naisu_phase_${intent.recipientAddress}_${intent.nonce}`);
      if (raw) return 'tracking';
    } catch { /* storage unavailable */ }
    return 'plan';
  });
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState(intent.durationSeconds);
  const [slippagePct, setSlippagePct] = useState(10);
  // Local signing state — stays in sign phase until activeIntent appears or error occurs
  const [localSigning, setLocalSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  // 1-second ticker for live auction price (only active in tracking phase)
  const [now, setNow] = useState(Date.now());
  // Copy feedback state — tracks which step key (or 'intentId') was recently copied
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1200);
    }).catch(() => {/* ignore */});
  };

  // Early return for archived/historical widgets
  if (isHistoricalIntent && phase !== 'tracking' && phase !== 'done') {
    return (
      <div className="group flex gap-3 opacity-0 animate-fade-in-up" style={{ animationDelay: '0ms', animationFillMode: 'forwards' }}>
        <div className="flex-shrink-0 mt-1 hidden sm:block">
           <div className="size-8 rounded-full bg-[#0a100f] border border-white/5 flex items-center justify-center grayscale opacity-50">
             <span className="material-symbols-outlined text-white text-[16px]">smart_toy</span>
           </div>
        </div>
        <div className="flex-1 min-w-0">
          <MessageHeader name="Nesu" timestamp={undefined} />
          <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[#0a100f] border border-white/5 text-slate-500 text-xs font-mono shadow-sm">
            <span className="material-symbols-outlined text-[14px]">history</span>
            <span>Quote expired • {intent.amount} ETH → {intent.destinationChain === 'solana' ? 'Solana' : 'Sui'}</span>
          </div>
        </div>
      </div>
    );
  }

  // Live intent progress from Zustand store (used in tracking phase)
  const activeIntent = useIntentStore((state) => state.activeIntent);

  // Smooth phase transition: fade out → swap → fade in
  const transitionTo = (next: 'plan' | 'sign' | 'tracking' | 'done') => {
    setIsTransitioning(true);
    setTimeout(() => {
      setPhase(next);
      setIsTransitioning(false);
    }, 200);
  };

  // Signal to MessageBubble that this bubble is handling progress tracking
  useEffect(() => {
    setBubbleTracking(phase === 'tracking');
  }, [phase]);

  // Live ticker — only ticks when tracking
  useEffect(() => {
    if (phase !== 'tracking') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // Sign error recovery: when parent reports failure, go back to sign + show error
  useEffect(() => {
    if (isSignFailed && localSigning) {
      setLocalSigning(false);
      setSignError(signStatus ?? 'Signature rejected. Please try again.');
    }
  }, [isSignFailed, signStatus, localSigning]);

  // Sign success: when activeIntent appears in store while signing, transition to tracking
  useEffect(() => {
    if (activeIntent && localSigning) {
      setLocalSigning(false);
      setSignError(null);
      // Persist phase to localStorage so refresh/navigation restores the correct state
      try { localStorage.setItem(phaseKey, 'tracking'); } catch { /* storage unavailable */ }
      // Set flag immediately to suppress the standalone receipt card before phase changes
      setBubbleTracking(true);
      setIsTransitioning(true);
      setTimeout(() => {
        setPhase('tracking');
        setIsTransitioning(false);
      }, 200);
    }
  }, [activeIntent, localSigning, phaseKey]);

  // Persist fulfilled snapshot to localStorage so historical sessions can display
  // Bridge Complete even when Zustand store is cleared (e.g. after session switch).
  useEffect(() => {
    if (activeIntent?.isFulfilled && phase === 'tracking') {
      try {
        localStorage.setItem(phaseKey, JSON.stringify({
          isFulfilled: true,
          intentId: activeIntent.intentId,
          fillPrice: activeIntent.fillPrice,
          winnerSolver: activeIntent.winnerSolver,
          progress: activeIntent.progress,
          signedAt: activeIntent.signedAt,
          fulfilledAt: activeIntent.fulfilledAt,
          sourceTxHash: activeIntent.sourceTxHash,
          settledTxHash: activeIntent.settledTxHash,
          destinationTxHash: activeIntent.destinationTxHash,
        }));
      } catch { /* storage unavailable */ }
    }
  }, [activeIntent?.isFulfilled, phase, phaseKey, activeIntent]);

  const { fromUsd, toUsd } = usePythPrices(intent.amount, intent.destinationChain, intent.fromUsd, intent.toUsd);

  const destLabel = intent.destinationChain === 'solana' ? 'Solana' : intent.destinationChain;
  const tokenLabel = intent.outputToken === 'sol' ? 'SOL' : intent.outputToken === 'msol' ? 'mSOL' : intent.outputToken.toUpperCase();

  const formatSol = (lamports: string) => {
    try { return (Number(BigInt(lamports)) / 1e9).toFixed(4); } catch { return lamports; }
  };

  const startSol = formatSol(intent.startPrice);
  const adjustedFloorPrice = (() => {
    try { return (BigInt(intent.startPrice) * BigInt(100 - slippagePct) / 100n).toString(); } catch { return intent.floorPrice; }
  })();
  const adjustedFloorSol = formatSol(adjustedFloorPrice);
  const currentOption = DURATION_OPTIONS_BUBBLE.find(o => o.seconds === selectedDuration) || DURATION_OPTIONS_BUBBLE[1];

  const inputUsd = fromUsd != null ? (parseFloat(intent.amount) * fromUsd).toFixed(2) : null;
  const outputUsd = toUsd != null ? (parseFloat(startSol) * toUsd).toFixed(2) : null;
  const minOutputUsd = toUsd != null ? (parseFloat(adjustedFloorSol) * toUsd).toFixed(2) : null;
  const exchangeRate = parseFloat(intent.amount) > 0 ? (parseFloat(startSol) / parseFloat(intent.amount)).toFixed(2) : '0';

  // Plan Phase — horizontal 2-column layout for desktop/laptop/tablet
  if (phase === 'plan') {
    return (
      <div className="group flex gap-3 opacity-0 animate-fade-in-up" style={{ animationDelay: '0ms', animationFillMode: 'forwards' }}>
        <div className="flex-shrink-0 mt-1 hidden sm:block">
          <div className="size-8 rounded-full bg-gradient-to-br from-primary/80 to-teal-800 flex items-center justify-center shadow-[0_0_16px_rgba(13,242,223,0.25)] ring-1 ring-primary/20">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m12.728 0l-.707.707M12 21v-1m0-16a9 9 0 110 18 9 9 0 010-18z" />
            </svg>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[12px] font-semibold text-white">Nesu</span>
            <span className="text-[10px] text-slate-500">just now</span>
          </div>

          <div className={`rounded-[20px] overflow-hidden border border-white/5 bg-[#0A0A0A] shadow-2xl font-sans transition-all duration-200 ${isTransitioning ? 'opacity-0 scale-[0.985] translate-y-1' : 'opacity-100 scale-100 translate-y-0'}`}>
            {/* Header */}
            <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap size={13} className="text-[#0df2df] fill-[#0df2df]" />
                <span className="text-[12px] font-semibold text-white tracking-wide">Live Quote</span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-medium">
                <div className="w-1.5 h-1.5 rounded-full bg-[#0df2df]" />
                <span>Pyth Oracle</span>
              </div>
            </div>

            {/* Body — 2 columns */}
            <div className="flex">
              {/* LEFT: quote info */}
              <div className="flex-1 min-w-0 p-4 flex flex-col gap-3 border-r border-white/5 justify-center">
                {/* Conversion */}
                <div>
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[26px] font-bold text-white leading-none tabular-nums">{intent.amount}</span>
                        <span className="text-[13px] text-slate-400 font-medium">ETH</span>
                      </div>
                      <span className="text-[10px] text-slate-600">Base Sepolia</span>
                    </div>
                    <ArrowRight size={18} className="text-[#0df2df] shrink-0 mt-2" />
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[26px] font-bold text-[#0df2df] leading-none tabular-nums">~{startSol}</span>
                        <span className="text-[13px] text-[#0df2df]/80 font-medium">{tokenLabel}</span>
                      </div>
                      <span className="text-[10px] text-slate-600">{destLabel}</span>
                    </div>
                  </div>
                  {inputUsd != null && outputUsd != null && (
                    <div className="mt-2 inline-flex items-center gap-2 bg-white/[0.03] border border-white/5 rounded-full px-3 py-1 text-[11px] text-slate-400">
                      <span>≈${inputUsd}</span>
                      <span className="opacity-40">→</span>
                      <span>≈${outputUsd}</span>
                    </div>
                  )}
                </div>

                {/* Rate & Min Receive — compact grid */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="p-3 rounded-xl bg-[#0F0F0F] border border-white/5 flex flex-col gap-1.5">
                    <div className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">Rate</div>
                    <div className="text-[13px] font-bold text-white font-mono leading-tight">
                      1 ETH = {exchangeRate} {tokenLabel}
                    </div>
                    <div className="text-[9px] text-slate-600 mt-auto">Powered by Pyth Network</div>
                  </div>
                  <div className="p-3 rounded-xl bg-[#0F0F0F] border border-green-500/20 flex flex-col gap-1.5 relative overflow-hidden">
                    <div className="absolute top-1.5 right-1.5 opacity-[0.05]">
                      <ShieldCheck size={36} className="text-[#0df2df]" />
                    </div>
                    <div className="flex items-center gap-1 relative z-10">
                      <ShieldCheck size={10} className="text-green-500" />
                      <div className="text-[9px] text-green-500 uppercase tracking-widest font-bold">Min. Receive</div>
                    </div>
                    <div className="text-[16px] font-bold text-green-400 font-mono leading-none relative z-10">
                      {adjustedFloorSol} <span className="text-[10px] font-semibold">{tokenLabel}</span>
                    </div>
                    {minOutputUsd != null && (
                      <div className="text-[10px] text-slate-400 relative z-10">≈${minOutputUsd}</div>
                    )}
                    <div className="text-[8px] text-green-500/50 uppercase tracking-widest font-bold mt-auto relative z-10">
                      Guaranteed On-Chain
                    </div>
                  </div>
                </div>

                {/* Separator + Recipient */}
                <div className="border-t border-white/5 pt-3 space-y-1.5">
                  <div className="text-[10px] text-slate-500">Recipient on {destLabel}</div>
                  <div className="font-mono text-[9px] text-slate-400 bg-[#0F0F0F] px-2.5 py-2 rounded-lg border border-white/5 truncate" title={intent.recipientAddress}>
                    {intent.recipientAddress}
                  </div>
                </div>
              </div>

              {/* RIGHT: settings + action */}
              <div className="w-[240px] shrink-0 p-5 flex flex-col gap-4">
                {/* Duration */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Clock size={11} className="text-[#0df2df]" />
                      <span className="text-[11px] font-semibold text-white">Auction Duration</span>
                    </div>
                    <span className="text-[9px] text-slate-500">Longer = better</span>
                  </div>
                  <div className="flex gap-1.5">
                    {DURATION_OPTIONS_BUBBLE.map((opt) => {
                      const isSelected = selectedDuration === opt.seconds;
                      return (
                        <button
                          key={opt.seconds}
                          onClick={() => setSelectedDuration(opt.seconds)}
                          className={`flex-1 py-2 rounded-[10px] text-[11px] font-bold transition-all duration-200 ${
                            isSelected
                              ? 'bg-[#0df2df] text-black shadow-[0_2px_8px_rgba(13,242,223,0.2)]'
                              : 'bg-[#111] border border-white/5 text-slate-400 hover:text-white'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Slippage */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <SlidersHorizontal size={11} className="text-[#0df2df]" />
                      <span className="text-[11px] font-semibold text-white">Slippage</span>
                    </div>
                    <span className="text-[9px] text-slate-500">Higher = faster fill</span>
                  </div>
                  <div className="flex gap-1.5">
                    {SLIPPAGE_OPTIONS.map((opt) => {
                      const isSelected = slippagePct === opt.pct;
                      return (
                        <button
                          key={opt.pct}
                          onClick={() => setSlippagePct(opt.pct)}
                          className={`flex-1 py-2 rounded-[10px] text-[11px] font-bold transition-all duration-200 flex flex-col items-center gap-0.5 ${
                            isSelected
                              ? 'bg-[#0df2df] text-black shadow-[0_2px_8px_rgba(13,242,223,0.2)]'
                              : 'bg-[#111] border border-white/5 text-slate-400 hover:text-white'
                          }`}
                        >
                          <span>{opt.label}</span>
                          <span className={`text-[8px] ${isSelected ? 'text-black/50' : 'text-slate-600'}`}>{opt.hint}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between px-0.5 text-[10px]">
                    <span className="text-slate-600">Min: <span className="text-green-400 font-semibold">{adjustedFloorSol} {tokenLabel}</span></span>
                    <span className="text-slate-700">−{slippagePct}%</span>
                  </div>
                </div>

                {/* CTA */}
                <button
                  onClick={() => {
                    onDutchPlanConfirm?.({ ...intent, floorPrice: adjustedFloorPrice, durationSeconds: selectedDuration });
                    transitionTo('sign');
                  }}
                  className="mt-auto w-full py-3 rounded-[13px] bg-[linear-gradient(135deg,_#0df2df_93%,_#80faf1_93%)] hover:opacity-90 text-black text-[12px] font-bold transition-all duration-200 active:scale-[0.98] shadow-[0_0_16px_rgba(13,242,223,0.12)] flex items-center justify-center gap-1.5"
                >
                  Looks good
                  <ArrowRight size={13} className="stroke-[2.5]" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Sign Phase
  if (phase === 'sign') {
    return (
      <div className="group flex gap-3 opacity-0 animate-fade-in-up" style={{ animationDelay: '0ms', animationFillMode: 'forwards' }}>
        <div className="flex-shrink-0 mt-1 hidden sm:block">
          <div className="size-8 rounded-full bg-gradient-to-br from-primary/80 to-teal-800 flex items-center justify-center shadow-[0_0_16px_rgba(13,242,223,0.25)] ring-1 ring-primary/20">
            <span className="material-symbols-outlined text-white text-[16px]">smart_toy</span>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[12px] font-semibold text-white">Nesu</span>
            <span className="text-[10px] text-slate-500">just now</span>
          </div>

          <div className={`rounded-[20px] overflow-hidden border border-white/5 bg-[#0A0A0A] shadow-2xl font-sans transition-all duration-200 ${isTransitioning ? 'opacity-0 scale-[0.985] translate-y-1' : 'opacity-100 scale-100 translate-y-0'}`}>
            {/* Header */}
            <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-[#0df2df]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <span className="text-[12px] font-semibold text-white tracking-wide">Sign Intent</span>
              </div>
              <div className="flex items-center gap-1.5 text-[9px]">
                <span className="font-mono text-slate-600 tracking-tight">EIP-712</span>
                <span className="text-slate-700">·</span>
                <span className="flex items-center gap-1 text-green-500 font-bold uppercase tracking-widest">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                  Gasless
                </span>
              </div>
            </div>

            {/* Error banner — full-width row, same as header, with border-b */}
            {signError && (
              <div className="px-5 py-2.5 border-b border-red-500/15 bg-red-500/5 flex items-center gap-2">
                <span className="text-red-400 text-[11px] shrink-0">✕</span>
                <p className="text-[10px] text-red-400 leading-snug">{signError}</p>
              </div>
            )}

            {/* Body — 2 columns */}
            <div className="flex">
              {/* LEFT: what you're signing */}
              <div className="flex-1 min-w-0 p-5 flex flex-col gap-4 border-r border-white/5 justify-center">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-2">You are bridging</div>
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[26px] font-bold text-white leading-none tabular-nums">{intent.amount}</span>
                        <span className="text-[13px] text-slate-400 font-medium">ETH</span>
                      </div>
                      <span className="text-[10px] text-slate-600">Base Sepolia</span>
                    </div>
                    <ArrowRight size={18} className="text-[#0df2df] shrink-0 mt-2" />
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[26px] font-bold text-[#0df2df] leading-none tabular-nums">~{startSol}</span>
                        <span className="text-[13px] text-[#0df2df]/80 font-medium">{tokenLabel}</span>
                      </div>
                      <span className="text-[10px] text-slate-600">{destLabel}</span>
                    </div>
                  </div>
                  {inputUsd != null && outputUsd != null && (
                    <div className="mt-2 inline-flex items-center gap-2 bg-white/[0.03] border border-white/5 rounded-full px-3 py-1 text-[11px] text-slate-400">
                      <span>≈${inputUsd}</span>
                      <span className="opacity-40">→</span>
                      <span>≈${outputUsd}</span>
                    </div>
                  )}
                </div>

                {/* Min receive highlight */}
                <div className="p-3 rounded-xl bg-[#0F0F0F] border border-green-500/20 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck size={12} className="text-green-500" />
                    <span className="text-[10px] text-green-500 uppercase tracking-widest font-bold">Guaranteed Min.</span>
                  </div>
                  <div className="text-[14px] font-bold text-green-400 font-mono">
                    {adjustedFloorSol} <span className="text-[10px] font-semibold">{tokenLabel}</span>
                    {minOutputUsd != null && <span className="text-[10px] text-slate-500 font-normal ml-1">≈${minOutputUsd}</span>}
                  </div>
                </div>

                {/* Recipient */}
                <div className="border-t border-white/5 pt-3 space-y-1.5">
                  <div className="text-[10px] text-slate-500">Recipient on {destLabel}</div>
                  <div className="font-mono text-[9px] text-slate-400 bg-[#0F0F0F] px-2.5 py-2 rounded-lg border border-white/5 truncate" title={intent.recipientAddress}>
                    {intent.recipientAddress}
                  </div>
                </div>
              </div>

              {/* RIGHT: summary + action */}
              <div className="w-[220px] shrink-0 p-5 flex flex-col gap-3">
                <div className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Your settings</div>

                {/* Summary rows */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-[#0F0F0F] border border-white/5">
                    <div className="flex items-center gap-1.5">
                      <Clock size={10} className="text-[#0df2df]" />
                      <span className="text-[10px] text-slate-400">Duration</span>
                    </div>
                    <span className="text-[11px] font-semibold text-white">{currentOption.label}</span>
                  </div>
                  <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-[#0F0F0F] border border-white/5">
                    <div className="flex items-center gap-1.5">
                      <SlidersHorizontal size={10} className="text-[#0df2df]" />
                      <span className="text-[10px] text-slate-400">Slippage</span>
                    </div>
                    <span className="text-[11px] font-semibold text-white">{slippagePct}%</span>
                  </div>
                  <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-[#0F0F0F] border border-white/5">
                    <span className="text-[10px] text-slate-400">Network fee</span>
                    <span className="text-[11px] font-bold text-green-400">Free</span>
                  </div>
                </div>

                {/* Buttons */}
                <div className="mt-auto flex flex-col gap-2 pt-2">
                  <button
                    onClick={() => {
                      setSignError(null);
                      setLocalSigning(true);
                      onSignIntent?.();
                      // Transition happens via useEffect when activeIntent appears in store
                    }}
                    disabled={localSigning}
                    className="w-full py-3 rounded-[13px] bg-[linear-gradient(135deg,_#0df2df_93%,_#80faf1_93%)] hover:opacity-90 disabled:opacity-50 text-black text-[12px] font-bold transition-all duration-200 active:scale-[0.98] shadow-[0_0_16px_rgba(13,242,223,0.12)] flex items-center justify-center gap-1.5"
                  >
                    {localSigning ? (
                      <>
                        <div className="w-3.5 h-3.5 rounded-full border-2 border-black/20 border-t-black animate-spin" />
                        Waiting for signature…
                      </>
                    ) : (
                      <>
                        Sign & Submit
                        <ArrowRight size={13} className="stroke-[2.5]" />
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => { setSignError(null); transitionTo('plan'); }}
                    disabled={localSigning}
                    className="w-full py-2 rounded-[10px] bg-white/3 hover:bg-white/8 border border-white/5 text-slate-400 hover:text-white disabled:opacity-30 text-[11px] font-medium transition-colors"
                  >
                    ← Back
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Tracking Phase — live Dutch auction + bridge execution status
  if (phase === 'tracking') {
    // Read localStorage snapshot as fallback when Zustand is null (historical session,
    // or after session switch where clearActiveIntent was called).
    const localSnap = (() => {
      try {
        const raw = localStorage.getItem(phaseKey);
        if (!raw) return null;
        if (raw.startsWith('{')) return JSON.parse(raw) as {
          isFulfilled?: boolean; intentId?: string; fillPrice?: string; winnerSolver?: string;
          progress?: import('@/store').ProgressStep[]; signedAt?: number; fulfilledAt?: number;
          sourceTxHash?: string; settledTxHash?: string; destinationTxHash?: string;
        };
        return null; // raw = 'tracking' (written before fulfillment)
      } catch { return null; }
    })();

    const isComplete   = activeIntent?.isFulfilled   ?? localSnap?.isFulfilled   ?? false;
    const progress     = activeIntent?.progress      ?? localSnap?.progress       ?? [];
    const fillPrice    = activeIntent?.fillPrice     ?? localSnap?.fillPrice;
    const winnerSolver = activeIntent?.winnerSolver  ?? localSnap?.winnerSolver;
    const signedAtMs   = activeIntent?.signedAt      ?? localSnap?.signedAt       ?? now;
    const srcTxHash    = activeIntent?.sourceTxHash      ?? localSnap?.sourceTxHash;
    const destTxHash   = activeIntent?.destinationTxHash ?? localSnap?.destinationTxHash;
    const settledTxHash = (activeIntent as import('@/store').ActiveIntent | null)?.settledTxHash ?? localSnap?.settledTxHash;
    const displayIntentId = activeIntent?.intentId ?? localSnap?.intentId;
    const fillTimeSec  = (activeIntent?.signedAt ?? localSnap?.signedAt) &&
                         (activeIntent?.fulfilledAt ?? localSnap?.fulfilledAt)
      ? Math.round(((activeIntent?.fulfilledAt ?? localSnap?.fulfilledAt)! -
                    (activeIntent?.signedAt    ?? localSnap?.signedAt)!) / 1000)
      : null;

    // Determine current execution phase
    const activeStep = progress.find(s => s.active);
    const isAuctionPhase = !activeStep || ['rfq', 'winner'].includes(activeStep.key);
    const isExecPhase = activeStep && ['evm_submitted', 'sol_sent', 'vaa_ready', 'settled'].includes(activeStep.key);

    // Dutch auction live calcs
    const elapsedSec   = Math.max(0, Math.floor((now - signedAtMs) / 1000));
    const durationSec  = selectedDuration;
    const progressRatio = Math.min(elapsedSec / durationSec, 1);
    const remainingSec = Math.max(0, durationSec - elapsedSec);
    const currentPriceSol = (() => {
      try {
        const startL = BigInt(intent.startPrice);
        const floorL = BigInt(adjustedFloorPrice);
        const drop = startL - floorL;
        const elapsed1000 = BigInt(Math.floor(progressRatio * 1000));
        return (Number(startL - drop * elapsed1000 / 1000n) / 1e9).toFixed(4);
      } catch { return startSol; }
    })();
    const currentUsdVal = toUsd != null ? (parseFloat(currentPriceSol) * toUsd).toFixed(2) : null;
    const fillUsdVal    = fillPrice != null && toUsd != null ? (parseFloat(fillPrice) * toUsd).toFixed(2) : null;

    // Header label
    const headerLabel = isComplete ? 'Bridge Complete'
      : isExecPhase ? 'Executing Bridge'
      : 'Dutch Auction Live';

    // Per-step icon helper
    const getStepIcon = (key: string) => {
      switch (key) {
        case 'signed':        return CheckCircle2;
        case 'rfq':           return Radio;
        case 'winner':        return Trophy;
        case 'evm_submitted': return Link;
        case 'sol_sent':      return Send;
        case 'vaa_ready':     return Shield;
        case 'settled':       return Sparkles;
        default:              return CheckCircle2;
      }
    };

    // tx hash chip config per step key
    const stepTxChip = (step: import('@/store').ProgressStep) => {
      if (!step.txHash) return null;
      const isSolana = step.key === 'sol_sent';
      return {
        short: isSolana
          ? `${step.txHash.slice(0, 8)}…${step.txHash.slice(-4)}`
          : `${step.txHash.slice(0, 10)}…${step.txHash.slice(-6)}`,
        href: isSolana
          ? `https://solscan.io/tx/${step.txHash}?cluster=devnet`
          : `https://sepolia.basescan.org/tx/${step.txHash}`,
        label: isSolana ? 'Solscan' : 'BaseScan',
      };
    };

    return (
      <div className="group flex gap-3">
        <div className="flex-shrink-0 mt-1 hidden sm:block">
          <div className="size-8 rounded-full bg-gradient-to-br from-primary/80 to-teal-800 flex items-center justify-center shadow-[0_0_16px_rgba(13,242,223,0.25)] ring-1 ring-primary/20">
            <span className="material-symbols-outlined text-white text-[16px]">smart_toy</span>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[12px] font-semibold text-white">Nesu</span>
            <span className="text-[10px] text-slate-500">just now</span>
          </div>

          <div className={`rounded-[20px] overflow-hidden border border-white/5 bg-[#0A0A0A] shadow-2xl font-sans transition-all duration-200 ${isTransitioning ? 'opacity-0 scale-[0.985] translate-y-1' : 'opacity-100 scale-100 translate-y-0'}`}>

            {/* ── Header ─────────────────────────────────────────────── */}
            <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isComplete
                  ? <CheckCircle2 size={13} className="text-green-400" />
                  : <div className="w-3 h-3 rounded-full border-[1.5px] border-[#0df2df]/30 border-t-[#0df2df] animate-spin" />
                }
                <span className="text-[12px] font-semibold text-white tracking-wide">{headerLabel}</span>
                {!isComplete && (
                  <span className="flex items-center gap-1 text-[10px] text-slate-500">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#0df2df] animate-pulse" />
                    {elapsedSec}s elapsed
                  </span>
                )}
              </div>
              <span className="text-[10px] font-mono text-slate-500 bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
                Base Sepolia
              </span>
            </div>

            {/* ── Body — 2 columns ───────────────────────────────────── */}
            <div className="flex">

              {/* LEFT column */}
              <div className="flex-1 min-w-0 p-5 flex flex-col gap-4 border-r border-white/5">

                {/* Amount row — always shown */}
                <div className="flex items-center gap-3">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[22px] font-bold text-white tabular-nums leading-none">{intent.amount}</span>
                      <span className="text-[12px] text-slate-400 font-medium">ETH</span>
                    </div>
                    <span className="text-[9px] text-slate-600">Base Sepolia</span>
                  </div>
                  <ArrowRight size={16} className={isComplete ? 'text-green-400 shrink-0' : 'text-[#0df2df] shrink-0'} />
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-baseline gap-1.5">
                      {isComplete
                        ? <span className="text-[22px] font-bold text-green-400 tabular-nums leading-none">{fillPrice ?? startSol}</span>
                        : <span className="text-[22px] font-bold text-[#0df2df] tabular-nums leading-none">~{startSol}</span>
                      }
                      <span className={`text-[12px] font-medium ${isComplete ? 'text-green-400/70' : 'text-[#0df2df]/70'}`}>{tokenLabel}</span>
                    </div>
                    <span className="text-[9px] text-slate-600">{destLabel}</span>
                  </div>
                </div>

                {/* Auction phase: live offer + progress bar */}
                {!isComplete && isAuctionPhase && (
                  <>
                    <div className="p-3.5 rounded-xl bg-[#0F0F0F] border border-[#0df2df]/15 relative overflow-hidden">
                      <div className="absolute inset-0 bg-gradient-to-br from-[#0df2df]/3 to-transparent pointer-events-none" />
                      <div className="relative z-10">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-[#0df2df] animate-pulse" />
                          <span className="text-[9px] text-[#0df2df]/70 uppercase tracking-widest font-bold">Current offer</span>
                        </div>
                        <div className="flex items-baseline gap-2">
                          <span className="text-[28px] font-bold text-[#0df2df] tabular-nums leading-none font-mono">{currentPriceSol}</span>
                          <span className="text-[13px] font-semibold text-[#0df2df]/70">{tokenLabel}</span>
                          {currentUsdVal && <span className="text-[10px] text-slate-500 ml-1">≈${currentUsdVal}</span>}
                        </div>
                        <div className="text-[9px] text-slate-600 mt-1">Solver who accepts this price wins the auction</div>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-500">Auction progress</span>
                        <span className={`font-semibold tabular-nums ${remainingSec < 30 ? 'text-amber-400' : 'text-slate-400'}`}>
                          {remainingSec > 0 ? `${remainingSec}s remaining` : 'Ending…'}
                        </span>
                      </div>
                      <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-[#0df2df] to-[#0df2df]/40 transition-all duration-1000"
                          style={{ width: `${Math.round(progressRatio * 100)}%` }} />
                      </div>
                      <div className="flex justify-between text-[9px] text-slate-600">
                        <span>Best: {startSol} {tokenLabel}</span>
                        <span>Floor: {adjustedFloorSol} {tokenLabel}</span>
                      </div>
                    </div>
                  </>
                )}

                {/* Execution phase: bridge status card */}
                {!isComplete && isExecPhase && activeStep && (
                  <div className="p-3.5 rounded-xl bg-[#0F0F0F] border border-[#0df2df]/10 space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="size-7 rounded-full bg-[#0df2df]/10 border border-[#0df2df]/20 flex items-center justify-center shrink-0">
                        <div className="w-3 h-3 rounded-full border-[1.5px] border-[#0df2df]/30 border-t-[#0df2df] animate-spin" />
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold text-[#0df2df]">{activeStep.label}</div>
                        <div className="text-[9px] text-slate-500 mt-0.5">{activeStep.detail ?? 'In progress…'}</div>
                      </div>
                    </div>
                    {winnerSolver && (
                      <div className="flex items-center justify-between text-[9px] border-t border-white/5 pt-2.5">
                        <span className="text-slate-600">Filled by</span>
                        <span className="text-slate-300 font-semibold">{winnerSolver}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Complete: you received — compact */}
                {isComplete && (
                  <div className="rounded-xl bg-green-500/8 border border-green-500/20 overflow-hidden">
                    {/* Received amount row */}
                    <div className="px-3 py-2.5 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <ShieldCheck size={10} className="text-green-500 shrink-0" />
                        <span className="text-[8.5px] text-green-500/70 uppercase tracking-widest font-bold">You received</span>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[18px] font-bold text-green-400 tabular-nums leading-none font-mono">{fillPrice ?? startSol}</span>
                        <span className="text-[11px] font-semibold text-green-400/70">{tokenLabel}</span>
                        {fillUsdVal && <span className="text-[9px] text-slate-500">≈${fillUsdVal}</span>}
                      </div>
                    </div>
                    {/* Price info row */}
                    <div className="px-3 py-1.5 border-t border-green-500/10 flex items-center justify-between">
                      <span className="text-[8.5px] text-slate-600">Best offer</span>
                      <span className="text-[8.5px] font-mono text-slate-400">{startSol} {tokenLabel}</span>
                    </div>
                    <div className="px-3 py-1.5 border-t border-green-500/10 flex items-center justify-between">
                      <span className="text-[8.5px] text-slate-600">Floor price</span>
                      <span className="text-[8.5px] font-mono text-slate-400">{adjustedFloorSol} {tokenLabel}</span>
                    </div>
                    {/* Filled by / fill time / fee row */}
                    <div className="px-3 py-1.5 border-t border-green-500/10 flex items-center gap-3">
                      {winnerSolver && (
                        <>
                          <div className="flex items-center gap-1">
                            <span className="text-[8px] text-slate-600">By</span>
                            <span className="text-[8.5px] font-semibold text-slate-300">{winnerSolver}</span>
                          </div>
                          <span className="text-slate-700">·</span>
                          <div className="flex items-center gap-1">
                            <span className="text-[8px] text-slate-600">Time</span>
                            <span className="text-[8.5px] font-semibold text-slate-300">{fillTimeSec != null ? `~${fillTimeSec}s` : '—'}</span>
                          </div>
                          <span className="text-slate-700">·</span>
                        </>
                      )}
                      <span className="text-[8.5px] font-semibold text-green-400">Free</span>
                    </div>
                  </div>
                )}

                {/* Recipient */}
                <div className="space-y-1">
                  <div className="text-[9px] text-slate-600">Recipient on {destLabel}</div>
                  <div className="font-mono text-[8.5px] text-slate-500 bg-[#0F0F0F] px-2 py-1.5 rounded-lg border border-white/5 truncate" title={intent.recipientAddress}>
                    {intent.recipientAddress}
                  </div>
                </div>

                {!isComplete && (
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-slate-600">Network fee</span>
                    <span className="text-[9px] font-bold text-green-400">Free <span className="text-green-600/70 font-normal">(solver pays)</span></span>
                  </div>
                )}

                {/* TX Receipts — complete state */}
                {isComplete && (srcTxHash || destTxHash || settledTxHash) && (
                  <div className="rounded-xl border border-white/5 overflow-hidden">
                    <div className="px-2.5 py-1.5 bg-white/[0.02] border-b border-white/5">
                      <span className="text-[8px] text-slate-600 uppercase tracking-widest font-bold">Transaction Receipts</span>
                    </div>
                    {srcTxHash && (
                      <TxReceiptRow
                        label="Base Sepolia"
                        badge="B"
                        badgeClass="bg-blue-500/15 border-blue-500/20 text-blue-400"
                        hash={srcTxHash}
                        href={`https://sepolia.basescan.org/tx/${srcTxHash}`}
                        copiedKey={copiedKey}
                        copyKey="srcTx"
                        onCopy={() => copyToClipboard(srcTxHash!, 'srcTx')}
                      />
                    )}
                    {destTxHash && (
                      <TxReceiptRow
                        label="Solana Devnet"
                        badge="S"
                        badgeClass="bg-purple-500/15 border-purple-500/20 text-purple-400"
                        hash={destTxHash}
                        href={`https://solscan.io/tx/${destTxHash}?cluster=devnet`}
                        copiedKey={copiedKey}
                        copyKey="destTx"
                        onCopy={() => copyToClipboard(destTxHash!, 'destTx')}
                      />
                    )}
                    {settledTxHash && (
                      <TxReceiptRow
                        label="Base Sepolia (settle)"
                        badge="B"
                        badgeClass="bg-blue-500/15 border-blue-500/20 text-blue-400"
                        hash={settledTxHash}
                        href={`https://sepolia.basescan.org/tx/${settledTxHash}`}
                        copiedKey={copiedKey}
                        copyKey="settledTx"
                        onCopy={() => copyToClipboard(settledTxHash!, 'settledTx')}
                      />
                    )}
                  </div>
                )}
              </div>

              {/* RIGHT column — progress stepper */}
              <div className="w-[220px] shrink-0 p-4 flex flex-col gap-2">
                <div className="text-[9px] text-slate-500 uppercase tracking-widest font-bold mb-1">Progress</div>

                {progress.length === 0 ? (
                  <div className="flex items-center gap-2 text-[11px] text-slate-500">
                    <div className="w-3 h-3 rounded-full border-[1.5px] border-[#0df2df]/30 border-t-[#0df2df] animate-spin shrink-0" />
                    Submitting to network…
                  </div>
                ) : (
                  <div className="flex flex-col">
                    {progress.map((step, idx) => {
                      const isLast = idx === progress.length - 1;
                      const StepIcon = getStepIcon(step.key);
                      const chip = stepTxChip(step);

                      return (
                        <div key={step.key} className="flex gap-2">
                          {/* Icon + connector */}
                          <div className="flex flex-col items-center shrink-0 w-[18px]">
                            <div className="shrink-0 z-10">
                              {step.done ? (
                                <div className="size-[18px] rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center">
                                  <StepIcon size={9} className="text-green-400" />
                                </div>
                              ) : step.active ? (
                                <div className="size-[18px] rounded-full bg-[#0df2df]/15 border border-[#0df2df]/30 flex items-center justify-center">
                                  <div className="w-2 h-2 rounded-full border border-[#0df2df]/30 border-t-[#0df2df] animate-spin" />
                                </div>
                              ) : (
                                <div className="size-[18px] rounded-full bg-white/3 border border-white/6 flex items-center justify-center">
                                  <div className="size-1 rounded-full bg-slate-800" />
                                </div>
                              )}
                            </div>
                            {!isLast && (
                              <div className={`w-px mt-0.5 ${step.done ? 'bg-green-500/25' : 'bg-white/6'}`}
                                style={{ minHeight: chip ? 28 : step.active && step.detail ? 26 : 16 }} />
                            )}
                          </div>

                          {/* Text content */}
                          <div className={`flex flex-col min-w-0 ${isLast ? 'pb-0' : 'pb-0'}`}
                            style={{ marginBottom: isLast ? 0 : chip ? 6 : step.active && step.detail ? 5 : 4 }}>
                            <span className={`text-[10px] font-medium leading-tight ${
                              step.done ? 'text-green-400' : step.active ? 'text-[#0df2df] font-semibold' : 'text-slate-700'
                            }`}>
                              {step.label}
                            </span>

                            {/* Active step detail */}
                            {step.active && step.detail && (
                              <span className="text-[8.5px] text-[#0df2df]/50 mt-0.5 leading-snug">{step.detail}</span>
                            )}

                            {/* Inline tx hash chip */}
                            {chip && (
                              <div className="flex items-center gap-1.5 mt-1 bg-white/[0.03] rounded-md px-1.5 py-0.5 border border-white/5 w-fit">
                                <span className="font-mono text-[9px] text-slate-400 leading-none">{chip.short}</span>
                                <a href={chip.href} target="_blank" rel="noreferrer"
                                  className="text-slate-600 hover:text-[#0df2df] transition-colors shrink-0" title={chip.label}>
                                  <span className="material-symbols-outlined text-[10px]">open_in_new</span>
                                </a>
                                <button
                                  onClick={() => copyToClipboard(step.txHash!, step.key)}
                                  className="text-slate-600 hover:text-slate-300 transition-colors shrink-0"
                                  title={copiedKey === step.key ? 'Copied!' : 'Copy'}
                                >
                                  <span className="material-symbols-outlined text-[10px]">
                                    {copiedKey === step.key ? 'check' : 'content_copy'}
                                  </span>
                                </button>
                              </div>
                            )}

                            {/* Done step detail (e.g. "VAA verified") — only if no txHash */}
                            {step.done && step.detail && !chip && (
                              <span className="text-[8.5px] text-green-400/40 mt-0.5 leading-snug">{step.detail}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Intent ID — small reference at bottom */}
                {displayIntentId && (
                  <div className="mt-auto pt-3 border-t border-white/5">
                    <div className="text-[8px] text-slate-700 uppercase tracking-wider mb-0.5">Intent ID</div>
                    <div className="flex items-center gap-1 bg-white/[0.02] rounded-md px-1.5 py-0.5 border border-white/5">
                      <span className="font-mono text-[8px] text-slate-600 truncate flex-1">
                        {`${displayIntentId.slice(0, 10)}…${displayIntentId.slice(-6)}`}
                      </span>
                      <button
                        onClick={() => copyToClipboard(displayIntentId, 'intentId')}
                        className="shrink-0 text-slate-700 hover:text-slate-500 transition-colors"
                        title={copiedKey === 'intentId' ? 'Copied!' : 'Copy Intent ID'}
                      >
                        <span className="material-symbols-outlined text-[9px]">
                          {copiedKey === 'intentId' ? 'check' : 'content_copy'}
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Done Phase (fallback — should not normally reach here)
  return null;
}
