/**
 * DutchAuctionPlanWidget - Interactive Dutch auction plan with duration selection
 */
import { useState } from 'react';
import { Clock, TrendingDown, Shield, ArrowRight, ChevronDown } from 'lucide-react';

interface DutchAuctionPlanWidgetProps {
  amount: string;
  startPrice: string;  // Lamports per second decay rate
  floorPrice: string;  // Minimum price in lamports
  durationSeconds: number;
  destinationChain: string;
  outputToken: string;
  recipientAddress?: string;
  onConfirm?: (plan: {
    durationSeconds: number;
    startPrice: string;
    floorPrice: string;
  }) => void;
  isConfirmed?: boolean;
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

const DURATION_OPTIONS = [
  { label: '2 min', seconds: 120 },
  { label: '5 min', seconds: 300 },
  { label: '10 min', seconds: 600 },
];

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
  durationSeconds: initialDuration,
  destinationChain,
  outputToken,
  recipientAddress,
  onConfirm,
  isConfirmed,
}: DutchAuctionPlanWidgetProps) {
  const [selectedDuration, setSelectedDuration] = useState(initialDuration);
  const [showDurationPicker, setShowDurationPicker] = useState(false);
  
  const destLabel = DEST_LABELS[destinationChain] ?? destinationChain;
  const tokenLabel = OUTPUT_TOKEN_LABELS[outputToken] ?? outputToken.toUpperCase();
  
  // Calculate prices based on selected duration
  // Assume startPrice is the decay rate per second, calculate total start output
  const floorSol = formatLamports(floorPrice);
  const calculatedStartSol = (Number(floorSol) * 1.1).toFixed(4); // 10% above floor for demo
  
  const currentOption = DURATION_OPTIONS.find(o => o.seconds === selectedDuration) || DURATION_OPTIONS[1];

  const handleConfirm = () => {
    if (onConfirm) {
      onConfirm({
        durationSeconds: selectedDuration,
        startPrice: calculatedStartSol,
        floorPrice,
      });
    }
  };

  return (
    <div className="rounded-xl overflow-hidden border border-primary/20 bg-[#0a1310] shadow-lg max-w-md">
      {/* Header */}
      <div className="px-4 py-2.5 bg-primary/5 border-b border-primary/10 flex items-center gap-2">
        <div className="size-5 rounded-md bg-primary/20 flex items-center justify-center">
          <TrendingDown className="text-primary" size={12} />
        </div>
        <span className="text-[11px] font-medium text-primary">Dutch Auction Plan</span>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Amount */}
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-bold text-white">{amount}</span>
          <span className="text-xs text-slate-400">ETH</span>
          <ArrowRight className="text-slate-600 mx-1" size={14} />
          <span className="text-lg font-bold text-primary">~{calculatedStartSol}</span>
          <span className="text-xs text-primary/80">{tokenLabel}</span>
        </div>

        {/* Price range */}
        <div className="flex items-center gap-3 text-xs">
          <div className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Start Price</div>
            <div className="font-medium text-slate-200">{calculatedStartSol} {tokenLabel}</div>
          </div>
          <TrendingDown className="text-slate-600" size={14} />
          <div className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Floor Price</div>
            <div className="font-medium text-slate-200">{floorSol} {tokenLabel}</div>
          </div>
        </div>

        {/* Duration Selector - INTERACTIVE */}
        {onConfirm && !isConfirmed && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <Clock size={12} className="text-primary/60" />
                Auction Duration
              </span>
              <button
                onClick={() => setShowDurationPicker(!showDurationPicker)}
                className="flex items-center gap-1 px-2 py-1 rounded bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary text-[11px] transition-colors"
              >
                {currentOption.label}
                <ChevronDown size={12} className={`transition-transform ${showDurationPicker ? 'rotate-180' : ''}`} />
              </button>
            </div>
            
            {showDurationPicker && (
              <div className="flex gap-2 p-2 rounded-lg bg-white/5 border border-white/10">
                {DURATION_OPTIONS.map((option) => (
                  <button
                    key={option.seconds}
                    onClick={() => {
                      setSelectedDuration(option.seconds);
                      setShowDurationPicker(false);
                    }}
                    className={`flex-1 py-1.5 px-2 rounded text-[11px] font-medium transition-all ${
                      selectedDuration === option.seconds
                        ? 'bg-primary/30 text-primary border border-primary/40'
                        : 'bg-transparent text-slate-400 hover:bg-white/5 border border-transparent'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
            
            <div className="text-[10px] text-slate-500">
              Price decays from <span className="text-slate-300">{calculatedStartSol} {tokenLabel}</span> to <span className="text-slate-300">{floorSol} {tokenLabel}</span> over <span className="text-slate-300">{formatDuration(selectedDuration)}</span>
            </div>
          </div>
        )}

        {/* Static info for confirmed state */}
        {(isConfirmed || !onConfirm) && (
          <div className="space-y-1.5 text-[11px]">
            <div className="flex items-center gap-2 text-slate-400">
              <Clock size={12} className="text-primary/60" />
              <span>Auction duration: <span className="text-slate-200">{formatDuration(selectedDuration)}</span></span>
            </div>
          </div>
        )}

        {/* Recipient */}
        {recipientAddress && (
          <div className="flex items-center gap-2 text-[11px] text-slate-400 pt-2 border-t border-white/5">
            <span className="text-[10px] text-slate-500 uppercase">Recipient:</span>
            <span className="font-mono text-slate-300">{recipientAddress.slice(0, 8)}...{recipientAddress.slice(-6)}</span>
          </div>
        )}
      </div>

      {/* Footer */}
      {onConfirm && !isConfirmed ? (
        <div className="px-4 py-3 bg-primary/5 border-t border-primary/20 space-y-2">
          <div className="flex items-center gap-2 text-[10px] text-slate-500">
            <Shield size={10} className="text-green-500/60" />
            <span>Minimum guaranteed: <span className="text-slate-300">{floorSol} {tokenLabel}</span></span>
          </div>
          <button
            onClick={handleConfirm}
            className="w-full py-2 px-4 rounded-lg bg-primary hover:bg-primary/90 text-black text-xs font-semibold transition-all active:scale-[0.98]"
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
