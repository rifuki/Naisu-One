// Receipt card - shows final state or live progress from Zustand store
import { useIntentStore } from '@/store';
import {
  CheckCircle2,
  Radio,
  Trophy,
  Link2,
  Sparkles,
  Circle,
  Loader2,
  ShieldCheck,
  ArrowRight,
  Zap,
} from 'lucide-react';

interface ProgressStep {
  key: string;
  label: string;
  detail?: string;
  done: boolean;
  active: boolean;
}

// Icon mapping for each progress step
const stepIcons: Record<string, React.ComponentType<{ className?: string; size?: number }>> = {
  signed: CheckCircle2,
  rfq: Radio,
  winner: Trophy,
  executing: Link2,
  fulfilled: Sparkles,
};

function StepIcon({ step, className }: { step: ProgressStep; className?: string }) {
  const Icon = stepIcons[step.key] || Circle;
  
  if (step.done) {
    return <CheckCircle2 className={`text-green-400 ${className}`} size={16} />;
  }
  if (step.active) {
    return <Loader2 className={`text-primary animate-spin ${className}`} size={16} />;
  }
  return <Icon className={`text-slate-500 ${className}`} size={16} />;
}

interface IntentReceiptData {
  intentId?: string;  // To match with active intent in Zustand store
  intent: {
    recipientAddress: string;
    destinationChain: string;
    amount: string;
    outputToken: string;
    startPrice: string;
    floorPrice: string;
    durationSeconds: number;
  };
  progress: ProgressStep[];
  fillPrice?: string;
  winnerSolver?: string;
  signedAt?: number;
  fulfilledAt?: number;
}

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

const DEST_LABELS: Record<string, string> = {
  solana: 'Solana',
  sui: 'Sui',
};

const OUTPUT_TOKEN_LABELS: Record<string, string> = {
  sol: 'SOL',
  msol: 'mSOL',
  marginfi: 'marginfi SOL',
};

interface IntentReceiptCardProps {
  data: IntentReceiptData;
}

export function IntentReceiptCard({ data }: IntentReceiptCardProps) {
  const { intent, progress, fillPrice: storedFillPrice, winnerSolver: storedWinnerSolver } = data;
  
  // Get live progress and completed intents from Zustand store
  const activeIntent = useIntentStore((state) => state.activeIntent);
  const getCompletedIntent = useIntentStore((state) => state.getCompletedIntent);
  
  // Check completed intents history for this receipt
  const completedIntent = data.intentId ? getCompletedIntent(data.intentId) : undefined;
  
  // Check if this receipt matches the active intent (by intentId or contractOrderId)
  const isActive = data.intentId && (
    activeIntent?.intentId === data.intentId || 
    activeIntent?.contractOrderId === data.intentId
  );
  
  // Priority: 1. Active intent (live), 2. Completed intent (history), 3. Stored data
  const currentProgress = isActive && activeIntent?.progress 
    ? activeIntent.progress 
    : completedIntent?.progress 
    ? completedIntent.progress 
    : progress;
  
  // Use live/completed fulfillment data if available
  const currentFillPrice = isActive && activeIntent?.fillPrice
    ? activeIntent.fillPrice
    : completedIntent?.fillPrice
    ? completedIntent.fillPrice
    : storedFillPrice;

  const currentWinnerSolver = isActive && activeIntent?.winnerSolver
    ? activeIntent.winnerSolver
    : completedIntent?.winnerSolver
    ? completedIntent.winnerSolver
    : storedWinnerSolver;

  const currentSignedAt = isActive && activeIntent?.signedAt
    ? activeIntent.signedAt
    : completedIntent?.signedAt
    ? completedIntent.signedAt
    : data.signedAt;

  const currentFulfilledAt = isActive && activeIntent?.fulfilledAt
    ? activeIntent.fulfilledAt
    : completedIntent?.fulfilledAt
    ? completedIntent.fulfilledAt
    : data.fulfilledAt;

  const fillTimeSec = currentSignedAt && currentFulfilledAt
    ? Math.round((currentFulfilledAt - currentSignedAt) / 1000)
    : null;
  
  // Check if this receipt was already fulfilled
  const wasFulfilled = !!completedIntent || storedFillPrice || storedWinnerSolver || data.fulfilledAt || 
    progress.every(p => p.done);
  
  const isComplete = currentProgress.every(p => p.done) || wasFulfilled || !!completedIntent;
  const destLabel = DEST_LABELS[intent.destinationChain] ?? intent.destinationChain;
  const tokenLabel = OUTPUT_TOKEN_LABELS[intent.outputToken] ?? intent.outputToken.toUpperCase();
  const startSol = formatLamports(intent.startPrice);
  const floorSol = formatLamports(intent.floorPrice);
  const displayPrice = currentFillPrice || startSol;
  const recipient = shortenAddress(intent.recipientAddress);

  return (
    <div className="rounded-[20px] overflow-hidden border border-white/5 bg-[#0A0A0A] shadow-2xl font-sans">
      {/* Header */}
      <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isComplete ? (
            <CheckCircle2 size={13} className="text-green-400" />
          ) : (
            <Zap size={13} className="text-[#0df2df] fill-[#0df2df]" />
          )}
          <span className="text-[12px] font-semibold text-white tracking-wide">
            {isComplete ? 'Bridge Complete' : 'Intent Active'}
          </span>
        </div>
        <span className="text-[10px] font-mono text-slate-500 bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
          Base Sepolia
        </span>
      </div>

      {/* Body — 2 columns */}
      <div className="flex">
        {/* LEFT: amounts + outcome */}
        <div className="flex-1 min-w-0 p-5 flex flex-col gap-4 border-r border-white/5 justify-center">
          {/* Conversion */}
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[26px] font-bold text-white leading-none tabular-nums">{intent.amount}</span>
              <span className="text-[13px] text-slate-400 font-medium">ETH</span>
              <ArrowRight size={18} className={isComplete ? 'text-green-400 shrink-0' : 'text-[#0df2df] shrink-0'} />
              {isComplete ? (
                <>
                  <span className="text-[26px] font-bold text-green-400 leading-none tabular-nums">{displayPrice}</span>
                  <span className="text-[13px] text-green-400/80 font-medium">{tokenLabel}</span>
                </>
              ) : (
                <>
                  <span className="text-[26px] font-bold text-[#0df2df] leading-none tabular-nums">~{startSol}</span>
                  <span className="text-[13px] text-[#0df2df]/80 font-medium">{tokenLabel}</span>
                </>
              )}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">on {destLabel}</div>
          </div>

          {/* You received — fulfilled only */}
          {isComplete && (
            <div className="grid grid-cols-2 gap-2.5">
              <div className="col-span-2 flex items-center justify-between py-3 px-4 rounded-xl bg-green-500/8 border border-green-500/20">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck size={12} className="text-green-500" />
                  <span className="text-[9px] text-green-500 uppercase tracking-widest font-bold">You received</span>
                </div>
                <div className="text-[18px] font-bold text-green-400 tabular-nums font-mono">
                  {displayPrice} <span className="text-[11px] font-semibold">{tokenLabel}</span>
                </div>
              </div>
              {currentWinnerSolver && (
                <>
                  <div className="flex flex-col gap-1 p-3 rounded-xl bg-[#0F0F0F] border border-white/5">
                    <div className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">Filled by</div>
                    <div className="text-[13px] font-semibold text-slate-200">{currentWinnerSolver}</div>
                  </div>
                  <div className="flex flex-col gap-1 p-3 rounded-xl bg-[#0F0F0F] border border-white/5">
                    <div className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">Fill time</div>
                    <div className="text-[13px] font-semibold text-slate-200">{fillTimeSec != null ? `~${fillTimeSec}s` : '—'}</div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Separator + Recipient + fee */}
          <div className="border-t border-white/5 pt-3 space-y-2">
            <div className="text-[10px] text-slate-500">Recipient on {destLabel}</div>
            <div className="font-mono text-[9px] text-slate-400 bg-[#0F0F0F] px-2.5 py-2 rounded-lg border border-white/5 truncate" title={intent.recipientAddress}>
              {intent.recipientAddress}
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-[10px] text-slate-500">Network fee</span>
              <span className="text-[11px] font-bold text-green-400">Free <span className="text-green-600/70 font-normal">(solver pays)</span></span>
            </div>
          </div>
        </div>

        {/* RIGHT: progress tracker */}
        <div className="w-[200px] shrink-0 p-5 flex flex-col gap-3">
          <div className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Progress</div>
          <div className="flex flex-col gap-0">
            {currentProgress.map((step, idx) => {
              const isLast = idx === currentProgress.length - 1;
              const StepIconComponent = stepIcons[step.key] || Circle;
              return (
                <div key={step.key} className="flex gap-2.5">
                  {/* Icon + line */}
                  <div className="flex flex-col items-center shrink-0 w-5">
                    <div className="relative z-10 shrink-0">
                      {step.done ? (
                        <div className="size-5 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center">
                          <CheckCircle2 size={11} className="text-green-400" />
                        </div>
                      ) : step.active ? (
                        <div className="size-5 rounded-full bg-[#0df2df]/15 border border-[#0df2df]/30 flex items-center justify-center">
                          <Loader2 size={11} className="text-[#0df2df] animate-spin" />
                        </div>
                      ) : (
                        <div className="size-5 rounded-full bg-white/4 border border-white/8 flex items-center justify-center">
                          <StepIconComponent size={10} className="text-slate-600" />
                        </div>
                      )}
                    </div>
                    {!isLast && (
                      <div className={`w-px flex-1 min-h-[18px] mt-0.5 ${step.done ? 'bg-green-500/30' : 'bg-white/8'}`} />
                    )}
                  </div>
                  {/* Text */}
                  <div className={`flex flex-col pb-3 ${isLast ? 'pb-0' : ''}`}>
                    <span className={`text-[11px] font-medium leading-tight ${
                      step.done ? 'text-green-400' : step.active ? 'text-[#0df2df]' : 'text-slate-600'
                    }`}>
                      {step.label}
                    </span>
                    {step.detail && (
                      <span className={`text-[9px] mt-0.5 leading-snug ${
                        step.done ? 'text-green-400/50' : step.active ? 'text-[#0df2df]/50' : 'text-slate-700'
                      }`}>
                        {step.detail}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export function extractReceiptData(content: string): IntentReceiptData | null {
  const prefix = '[INTENT_RECEIPT]';
  const index = content.indexOf(prefix);
  if (index === -1) return null;
  
  const jsonStr = content.slice(index + prefix.length);
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

export type { IntentReceiptData };
