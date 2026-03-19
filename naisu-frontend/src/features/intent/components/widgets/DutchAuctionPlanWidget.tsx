/**
 * DutchAuctionPlanWidget - Clean Dutch auction plan with solver info
 */
import { useState } from 'react';
import { Clock, TrendingDown, ChevronDown, Users, Zap, Shield } from 'lucide-react';

interface DutchAuctionPlanWidgetProps {
  amount: string;
  startPrice: string;
  floorPrice: string;
  durationSeconds: number;
  destinationChain: string;
  outputToken: string;
  recipientAddress?: string;
  onConfirm?: (plan: { durationSeconds: number; startPrice: string; floorPrice: string }) => void;
  isConfirmed?: boolean;
}

const DEST_LABELS: Record<string, string> = { solana: 'Solana', sui: 'Sui' };
const OUTPUT_TOKEN_LABELS: Record<string, string> = { sol: 'SOL', msol: 'mSOL', marginfi: 'marginfi SOL' };
const DURATION_OPTIONS = [
  { label: '2 min', seconds: 120 },
  { label: '5 min', seconds: 300 },
  { label: '10 min', seconds: 600 },
];

function formatSol(lamports: string): string {
  try { return (Number(BigInt(lamports)) / 1e9).toFixed(4); } catch { return lamports; }
}

function formatDuration(seconds: number): string {
  if (seconds >= 60) return `${Math.floor(seconds / 60)} min`;
  return `${seconds}s`;
}

export function DutchAuctionPlanWidget({
  amount, startPrice, floorPrice, durationSeconds: initialDuration,
  destinationChain, outputToken, recipientAddress, onConfirm, isConfirmed,
}: DutchAuctionPlanWidgetProps) {
  const [selectedDuration, setSelectedDuration] = useState(initialDuration);
  const [showDurationPicker, setShowDurationPicker] = useState(false);
  
  const startSol = formatSol(startPrice);
  const floorSol = formatSol(floorPrice);
  const destLabel = DEST_LABELS[destinationChain] ?? destinationChain;
  const tokenLabel = OUTPUT_TOKEN_LABELS[outputToken] ?? outputToken.toUpperCase();
  const currentOption = DURATION_OPTIONS.find(o => o.seconds === selectedDuration) || DURATION_OPTIONS[1];

  return (
    <div className="rounded-xl overflow-hidden border border-primary/20 bg-[#0a1310] shadow-lg max-w-sm">
      {/* Price Source Badge */}
      <div className="px-4 py-2 bg-primary/5 border-b border-primary/10 flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-primary/10 border border-primary/20">
          <Zap size={10} className="text-primary" />
          <span className="text-[10px] text-primary font-medium">Solvers compete to fill your intent</span>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Main conversion */}
        <div className="text-center space-y-1">
          <div className="text-2xl font-bold text-white">{amount} <span className="text-sm font-normal text-slate-400">ETH</span></div>
          <div className="text-xs text-slate-500">↓</div>
          <div className="text-xl font-bold text-primary">{startSol} - {floorSol} <span className="text-sm font-normal text-primary/70">{tokenLabel}</span></div>
          <div className="text-[10px] text-slate-500">Dutch auction • Price decays over time</div>
        </div>

        {/* Solver info */}
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-white/5 border border-white/10">
          <Users size={14} className="text-slate-400" />
          <span className="text-[11px] text-slate-300">
            <span className="text-primary font-medium">Multiple solvers</span> will bid to fill your order
          </span>
        </div>

        {/* How pricing works */}
        <div className="space-y-2">
          <div className="text-[10px] uppercase text-slate-500 tracking-wider">How pricing works</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2.5 rounded-lg bg-green-500/5 border border-green-500/20">
              <div className="text-[10px] text-green-500/80 mb-0.5">Best case (start)</div>
              <div className="text-sm font-semibold text-green-400">{startSol} {tokenLabel}</div>
            </div>
            <div className="p-2.5 rounded-lg bg-white/5 border border-white/10">
              <div className="text-[10px] text-slate-500 mb-0.5">Worst case (floor)</div>
              <div className="text-sm font-semibold text-slate-300">{floorSol} {tokenLabel}</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
            <Shield size={10} className="text-green-500" />
            <span>Floor price is <span className="text-slate-300">guaranteed on-chain</span></span>
          </div>
        </div>

        {/* Duration selector */}
        {onConfirm && !isConfirmed && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-300 flex items-center gap-1.5">
                <Clock size={12} className="text-primary" />
                Duration
              </span>
              <button
                onClick={() => setShowDurationPicker(!showDurationPicker)}
                className="flex items-center gap-1 px-2 py-1 rounded bg-primary/10 hover:bg-primary/20 text-primary text-[11px] font-medium transition-colors"
              >
                {currentOption.label}
                <ChevronDown size={10} className={`transition-transform ${showDurationPicker ? 'rotate-180' : ''}`} />
              </button>
            </div>
            {showDurationPicker && (
              <div className="flex gap-2">
                {DURATION_OPTIONS.map((opt) => (
                  <button
                    key={opt.seconds}
                    onClick={() => { setSelectedDuration(opt.seconds); setShowDurationPicker(false); }}
                    className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                      selectedDuration === opt.seconds ? 'bg-primary text-black' : 'bg-white/5 text-slate-400 hover:bg-white/10'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Recipient */}
        {recipientAddress && (
          <div className="pt-2 border-t border-white/5">
            <div className="text-[10px] text-slate-500 mb-1">Recipient on {destLabel}</div>
            <div className="font-mono text-[11px] text-slate-300 truncate">{recipientAddress}</div>
          </div>
        )}
      </div>

      {/* Footer */}
      {onConfirm && !isConfirmed ? (
        <div className="px-4 py-3 bg-primary/5 border-t border-primary/20">
          <button
            onClick={() => onConfirm?.({ durationSeconds: selectedDuration, startPrice, floorPrice })}
            className="w-full py-2.5 rounded-lg bg-primary hover:bg-primary/90 text-black text-sm font-semibold transition-all active:scale-[0.98]"
          >
            Confirm Plan
          </button>
        </div>
      ) : isConfirmed ? (
        <div className="px-4 py-2.5 bg-green-500/5 border-t border-green-500/20">
          <div className="flex items-center gap-2">
            <div className="size-4 rounded-full bg-green-500/20 flex items-center justify-center">
              <svg className="w-2.5 h-2.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <span className="text-[11px] text-green-400">Plan confirmed</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
