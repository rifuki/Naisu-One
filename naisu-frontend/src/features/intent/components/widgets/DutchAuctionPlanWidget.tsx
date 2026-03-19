/**
 * DutchAuctionPlanWidget - Displays Dutch auction plan details in chat history
 * Read-only version for showing confirmed plan after signing
 */
import { Clock, TrendingDown, Shield, ArrowRight } from 'lucide-react';

interface DutchAuctionPlanWidgetProps {
  amount: string;
  startPrice: string;
  floorPrice: string;
  durationSeconds: number;
  destinationChain: string;
  outputToken: string;
  recipientAddress?: string;
  onConfirm?: () => void; // If provided, show Confirm button
  isConfirmed?: boolean; // If true, show "Plan confirmed" footer
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

function formatLamports(lamports: string): string {
  try {
    const val = Number(BigInt(lamports)) / 1e9;
    return val.toFixed(4);
  } catch {
    return lamports;
  }
}

function formatDuration(seconds: number): string {
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
  if (seconds >= 60) {
    const mins = Math.floor(seconds / 60);
    return `${mins} min`;
  }
  return `${seconds}s`;
}

export function DutchAuctionPlanWidget({
  amount,
  startPrice,
  floorPrice,
  durationSeconds,
  destinationChain,
  outputToken,
  recipientAddress,
  onConfirm,
  isConfirmed,
}: DutchAuctionPlanWidgetProps) {
  const startSol = formatLamports(startPrice);
  const floorSol = formatLamports(floorPrice);
  const destLabel = DEST_LABELS[destinationChain] ?? destinationChain;
  const tokenLabel = OUTPUT_TOKEN_LABELS[outputToken] ?? outputToken.toUpperCase();

  return (
    <div className="rounded-xl overflow-hidden border border-primary/20 bg-[#0a1310] shadow-lg max-w-md">
      {/* Header */}
      <div className="px-4 py-2.5 bg-primary/5 border-b border-primary/10 flex items-center gap-2">
        <div className="size-5 rounded-md bg-primary/20 flex items-center justify-center">
          <TrendingDown className="text-primary" size={12} />
        </div>
        <span className="text-[11px] font-medium text-primary">Dutch Auction Plan</span>
        <span className="ml-auto text-[10px] text-slate-500 flex items-center gap-1">
          <Clock size={10} />
          {formatDuration(durationSeconds)}
        </span>
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        {/* Amount */}
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-bold text-white">{amount}</span>
          <span className="text-xs text-slate-400">ETH</span>
          <ArrowRight className="text-slate-600 mx-1" size={14} />
          <span className="text-lg font-bold text-primary">~{startSol}</span>
          <span className="text-xs text-primary/80">{tokenLabel}</span>
        </div>

        {/* Price range */}
        <div className="flex items-center gap-3 text-xs">
          <div className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Start Price</div>
            <div className="font-medium text-slate-200">{startSol} {tokenLabel}</div>
          </div>
          <TrendingDown className="text-slate-600" size={14} />
          <div className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Floor Price</div>
            <div className="font-medium text-slate-200">{floorSol} {tokenLabel}</div>
          </div>
        </div>

        {/* Details */}
        <div className="space-y-1.5 text-[11px]">
          <div className="flex items-center gap-2 text-slate-400">
            <Shield size={12} className="text-green-500/60" />
            <span>Minimum guaranteed: <span className="text-slate-200">{floorSol} {tokenLabel}</span></span>
          </div>
          <div className="flex items-center gap-2 text-slate-400">
            <Clock size={12} className="text-primary/60" />
            <span>Auction duration: <span className="text-slate-200">{formatDuration(durationSeconds)}</span></span>
          </div>
          {recipientAddress && (
            <div className="flex items-center gap-2 text-slate-400">
              <span className="text-[10px] text-slate-500 uppercase">Recipient:</span>
              <span className="font-mono text-slate-300">{recipientAddress.slice(0, 8)}...{recipientAddress.slice(-6)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Footer - Confirm button or Confirmed status */}
      {onConfirm ? (
        <div className="px-4 py-3 bg-primary/5 border-t border-primary/20">
          <button
            onClick={onConfirm}
            className="w-full py-2 px-4 rounded-lg bg-primary/20 hover:bg-primary/30 border border-primary/40 text-primary text-xs font-medium transition-all active:scale-[0.98]"
          >
            Confirm Plan & Sign
          </button>
        </div>
      ) : isConfirmed ? (
        <div className="px-4 py-2 bg-green-500/5 border-t border-green-500/20">
          <div className="flex items-center gap-2">
            <div className="size-4 rounded-full bg-green-500/20 flex items-center justify-center">
              <svg className="w-2.5 h-2.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <span className="text-[10px] text-green-400/80">Plan confirmed — signed and submitted</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
