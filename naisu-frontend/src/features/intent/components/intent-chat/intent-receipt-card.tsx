// Receipt card - shows final state or live progress from Zustand store
import { useIntentStore } from '@/store';

interface ProgressStep {
  key: string;
  label: string;
  done: boolean;
  active: boolean;
}

interface IntentReceiptData {
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
  
  // Get live progress from Zustand store
  const activeIntent = useIntentStore((state) => state.activeIntent);
  
  // Check if this receipt matches the active intent
  const isActive = activeIntent?.contractOrderId === intent.recipientAddress || 
                   activeIntent?.intentId?.includes(intent.recipientAddress.slice(0, 20));
  
  // Use live progress if this is the active intent, otherwise use stored
  const currentProgress = isActive && activeIntent?.progress 
    ? activeIntent.progress 
    : progress;
  
  // Use live fulfillment data if available
  const currentFillPrice = isActive && activeIntent?.fillPrice 
    ? activeIntent.fillPrice 
    : storedFillPrice;
  
  const currentWinnerSolver = isActive && activeIntent?.winnerSolver
    ? activeIntent.winnerSolver
    : storedWinnerSolver;
  
  const isComplete = currentProgress.every(p => p.done);
  const destLabel = DEST_LABELS[intent.destinationChain] ?? intent.destinationChain;
  const tokenLabel = OUTPUT_TOKEN_LABELS[intent.outputToken] ?? intent.outputToken.toUpperCase();
  const startSol = formatLamports(intent.startPrice);
  const floorSol = formatLamports(intent.floorPrice);
  const displayPrice = currentFillPrice || startSol;
  const recipient = shortenAddress(intent.recipientAddress);

  return (
    <div className={`rounded-2xl overflow-hidden border ${isComplete ? 'border-green-500/50 bg-[#051405]' : 'border-primary/30 bg-[#070e0c]'} shadow-[0_0_40px_-8px_rgba(13,242,223,0.2)]`}>
      {/* Header */}
      <div className={`h-px w-full bg-gradient-to-r from-transparent to-transparent ${isComplete ? 'via-green-500/70' : 'via-primary/70'}`} />
      
      {/* Fulfilled banner */}
      {isComplete && (
        <div className="px-5 py-2 flex items-center gap-2 bg-green-500/10 border-b border-green-500/20">
          <span className="material-symbols-outlined text-green-400 text-[16px]">verified</span>
          <span className="text-[11px] font-bold text-green-400 uppercase tracking-[0.1em]">Fulfilled — Receipt</span>
          <span className="ml-auto text-[10px] text-green-500/60">Permanent record</span>
        </div>
      )}
      
      {/* Title row */}
      <div className="px-5 pt-4 pb-3 flex items-center gap-2 border-b border-white/5">
        <div className={`size-6 rounded-lg flex items-center justify-center shrink-0 ${isComplete ? 'bg-green-500/15 border border-green-500/20' : 'bg-primary/15 border border-primary/20'}`}>
          <span className={`material-symbols-outlined text-[14px] ${isComplete ? 'text-green-400' : 'text-primary'}`}>
            {isComplete ? 'check_circle' : 'signature'}
          </span>
        </div>
        <span className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isComplete ? 'text-green-400' : 'text-primary'}`}>
          {isComplete ? 'Intent Fulfilled' : 'Sign Intent'}
        </span>
        <span className={`ml-2 px-2 py-0.5 rounded-full text-green-400 text-[9px] font-bold uppercase tracking-wider ${isComplete ? 'bg-green-500/20 border border-green-500/30' : 'bg-green-500/20 border border-green-500/30 animate-pulse'}`}>
          FREE - No Gas
        </span>
        <span className="ml-auto text-[10px] font-mono text-slate-500 bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
          Base Sepolia
        </span>
      </div>

      <div className="flex items-stretch">
        {/* Left: details */}
        <div className="flex-1 px-5 py-4 flex flex-col gap-3">
          {/* Amount row */}
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-[22px] font-bold text-white tabular-nums">{intent.amount}</span>
            <span className="text-[13px] text-slate-400 font-medium">ETH</span>
            <span className="material-symbols-outlined text-slate-600 text-[16px]">arrow_forward</span>
            {isComplete ? (
              <>
                <span className="text-[22px] font-bold text-green-400 tabular-nums">{displayPrice}</span>
                <span className="text-[13px] font-semibold text-green-400">{tokenLabel}</span>
              </>
            ) : (
              <span className="text-[13px] font-semibold text-primary">
                ~{startSol} {tokenLabel}
              </span>
            )}
            <span className="text-[11px] text-slate-500">on {destLabel}</span>
          </div>

          {/* Recipient */}
          <div className="col-span-2 flex items-center justify-between py-1.5 px-3 rounded-lg bg-white/3 border border-white/6">
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-slate-500 text-[13px]">account_balance_wallet</span>
              <span className="text-[10px] text-slate-500 uppercase tracking-wider">Recipient</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-mono text-slate-200">{recipient}</span>
            </div>
          </div>

          {/* You received (when complete) */}
          {isComplete && (
            <div className="flex flex-col items-center justify-center py-4 px-4 rounded-xl bg-green-500/10 border border-green-500/30">
              <span className="text-[10px] text-green-400/80 uppercase tracking-[0.15em] mb-1">You Received</span>
              <div className="flex items-baseline gap-2">
                <span className="text-[32px] font-bold text-green-400 tabular-nums leading-none">{displayPrice}</span>
                <span className="text-[14px] font-semibold text-green-400">SOL</span>
              </div>
            </div>
          )}

          {/* Solver info */}
          {isComplete && currentWinnerSolver && (
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col px-3 py-2.5 rounded-lg bg-white/3 border border-white/5">
                <span className="text-[9px] text-slate-600 uppercase tracking-wider mb-0.5">Filled by</span>
                <span className="text-[12px] font-semibold text-slate-200">{currentWinnerSolver}</span>
              </div>
              <div className="flex flex-col px-3 py-2.5 rounded-lg bg-white/3 border border-white/5">
                <span className="text-[9px] text-slate-600 uppercase tracking-wider mb-0.5">Fill time</span>
                <span className="text-[12px] font-semibold text-slate-200">~14s</span>
              </div>
            </div>
          )}

          {/* Gas cost */}
          <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-green-500/5 border border-green-500/20">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-green-400 text-[14px]">local_gas_station</span>
              <span className="text-[10px] text-green-400 uppercase tracking-wider font-medium">Network Fee</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] font-bold text-green-400">FREE</span>
              <span className="text-[10px] text-green-500/70">(Solver pays)</span>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="w-px bg-white/5 self-stretch" />

        {/* Right: progress */}
        <div className="flex flex-col px-5 py-4 shrink-0 w-[200px]">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Progress</div>
          <div className="relative">
            {currentProgress.map((step, idx) => {
              const isLast = idx === currentProgress.length - 1;
              
              return (
                <div key={step.key} className="relative flex gap-3">
                  <div className="flex flex-col items-center shrink-0">
                    <div className="relative z-10">
                      {step.done ? (
                        <div className="size-6 rounded-full bg-green-500/20 border border-green-500/40 flex items-center justify-center">
                          <span className="material-symbols-outlined text-green-400 text-[14px]">check</span>
                        </div>
                      ) : step.active ? (
                        <div className="size-6 rounded-full bg-primary/20 border border-primary/50 flex items-center justify-center">
                          <div className="size-2.5 rounded-full bg-primary animate-pulse" />
                        </div>
                      ) : (
                        <div className="size-6 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                          <div className="size-1.5 rounded-full bg-slate-600" />
                        </div>
                      )}
                    </div>
                    {!isLast && (
                      <div 
                        className={`w-px flex-1 min-h-[24px] ${step.done ? 'bg-green-500/40' : 'bg-white/10'}`}
                        style={{ marginTop: '4px' }}
                      />
                    )}
                  </div>
                  <div className="flex flex-col pb-3">
                    <span className={`text-[11px] font-medium leading-tight ${
                      step.done ? 'text-green-400' : step.active ? 'text-primary' : 'text-slate-500'
                    }`}>
                      {step.label}
                    </span>
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
