/**
 * DutchAuctionPlanWidget - Interactive Dutch auction plan with duration selection
 */
import { useState } from 'react';
import { Clock, TrendingDown, Shield, ArrowRight, ChevronDown, Info } from 'lucide-react';

interface DutchAuctionPlanWidgetProps {
  amount: string;
  startPrice: string;
  floorPrice: string;
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
  
  const startSol = formatLamports(startPrice);
  const floorSol = formatLamports(floorPrice);
  
  // Estimate USD values (mock rates)
  const startUsd = (parseFloat(startSol) * 90).toFixed(2); // ~$90/SOL
  const floorUsd = (parseFloat(floorSol) * 90).toFixed(2);
  const ethUsd = (parseFloat(amount) * 2150).toFixed(2); // ~$2150/ETH
  
  const currentOption = DURATION_OPTIONS.find(o => o.seconds === selectedDuration) || DURATION_OPTIONS[1];

  const handleConfirm = () => {
    if (onConfirm) {
      onConfirm({
        durationSeconds: selectedDuration,
        startPrice,
        floorPrice,
      });
    }
  };

  return (
    <div className="rounded-xl overflow-hidden border border-primary/20 bg-[#0a1310] shadow-lg max-w-md">
      {/* Header */}
      <div className="px-4 py-3 bg-primary/5 border-b border-primary/10">
        <div className="flex items-center gap-2 mb-2">
          <div className="size-5 rounded-md bg-primary/20 flex items-center justify-center">
            <TrendingDown className="text-primary" size={12} />
          </div>
          <span className="text-[11px] font-medium text-primary">Dutch Auction Plan</span>
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Your <span className="text-white font-medium">{amount} ETH (~${ethUsd})</span> will get you approximately <span className="text-primary font-medium">{startSol} {tokenLabel} (~${startUsd})</span>. 
          The Dutch auction starts at <span className="text-primary">{startSol} {tokenLabel}</span> and floors at <span className="text-primary">{floorSol} {tokenLabel}</span> — 
          this minimum is <span className="text-green-400">enforced on-chain</span>, so you can't receive less than that.
        </p>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Price info box */}
        <div className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500 uppercase">You send</span>
            <span className="text-sm font-bold text-white">{amount} ETH</span>
          </div>
          <div className="flex items-center justify-center">
            <ArrowRight className="text-slate-600" size={14} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500 uppercase">You receive (min)</span>
            <span className="text-sm font-bold text-primary">{floorSol} {tokenLabel}</span>
          </div>
          <div className="text-[10px] text-slate-500 text-right">
            ~${floorUsd} at current rates
          </div>
        </div>

        {/* Duration Selector - INTERACTIVE */}
        {onConfirm && !isConfirmed && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-300 flex items-center gap-1.5">
                <Clock size={12} className="text-primary" />
                Auction Duration
              </span>
              <button
                onClick={() => setShowDurationPicker(!showDurationPicker)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 border border-primary/30 text-primary text-[11px] font-medium transition-colors"
              >
                {currentOption.label}
                <ChevronDown size={12} className={`transition-transform ${showDurationPicker ? 'rotate-180' : ''}`} />
              </button>
            </div>
            
            {showDurationPicker && (
              <div className="grid grid-cols-3 gap-2 p-2 rounded-lg bg-white/5 border border-white/10">
                {DURATION_OPTIONS.map((option) => (
                  <button
                    key={option.seconds}
                    onClick={() => {
                      setSelectedDuration(option.seconds);
                      setShowDurationPicker(false);
                    }}
                    className={`py-2 px-3 rounded-lg text-[11px] font-medium transition-all ${
                      selectedDuration === option.seconds
                        ? 'bg-primary text-black'
                        : 'bg-transparent text-slate-400 hover:bg-white/5'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Static duration for confirmed */}
        {(isConfirmed || !onConfirm) && (
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <Clock size={12} className="text-primary" />
            <span>Auction duration: <span className="text-slate-200 font-medium">{formatDuration(selectedDuration)}</span></span>
          </div>
        )}

        {/* Output token selection */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 uppercase">Output token:</span>
          <span className="text-[11px] text-slate-300">{tokenLabel}</span>
          {outputToken === 'msol' && (
            <span className="text-[10px] text-slate-500">(Marinade liquid staking)</span>
          )}
        </div>

        {/* Recipient */}
        {recipientAddress && (
          <div className="flex items-center gap-2 text-[11px] pt-2 border-t border-white/5">
            <span className="text-[10px] text-slate-500 uppercase">Recipient:</span>
            <span className="font-mono text-slate-300 bg-white/5 px-2 py-0.5 rounded">
              {recipientAddress.slice(0, 6)}...{recipientAddress.slice(-4)}
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      {onConfirm && !isConfirmed ? (
        <div className="px-4 py-4 bg-primary/5 border-t border-primary/20 space-y-3">
          <div className="flex items-start gap-2 text-[10px] text-slate-400">
            <Info size={12} className="text-primary mt-0.5 shrink-0" />
            <span>Select your options and click Confirm to proceed. Signing is completely free (no gas cost).</span>
          </div>
          <button
            onClick={handleConfirm}
            className="w-full py-3 px-4 rounded-lg bg-primary hover:bg-primary/90 text-black text-sm font-semibold transition-all active:scale-[0.98]"
          >
            Confirm to proceed
          </button>
        </div>
      ) : isConfirmed ? (
        <div className="px-4 py-3 bg-green-500/5 border-t border-green-500/20">
          <div className="flex items-center gap-2">
            <div className="size-5 rounded-full bg-green-500/20 flex items-center justify-center">
              <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <span className="text-[11px] text-green-400 font-medium">Plan confirmed — signed and submitted</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
