/**
 * DutchAuctionPlanWidget - Clean Dutch auction plan with premium UI
 */
import { useState } from 'react';
import { Zap, ShieldCheck, Check, ArrowRight, Clock } from 'lucide-react';

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

export function DutchAuctionPlanWidget({
  amount, startPrice, floorPrice, durationSeconds: initialDuration,
  destinationChain, outputToken, recipientAddress, onConfirm, isConfirmed,
}: DutchAuctionPlanWidgetProps) {
  const [selectedDuration, setSelectedDuration] = useState(initialDuration);
  
  const startSol = formatSol(startPrice);
  const floorSol = formatSol(floorPrice);
  const destLabel = DEST_LABELS[destinationChain] ?? destinationChain;
  const tokenLabel = OUTPUT_TOKEN_LABELS[outputToken] ?? outputToken.toUpperCase();

  const ethUsd = 3100;
  const solUsd = 150;
  const inputUsd = (parseFloat(amount) * ethUsd).toFixed(2);
  const outputUsd = (parseFloat(startSol) * solUsd).toFixed(2);
  const minOutputUsd = (parseFloat(floorSol) * solUsd).toFixed(2);
  const exchangeRate = parseFloat(amount) > 0 ? (parseFloat(startSol) / parseFloat(amount)).toFixed(2) : '0';

  return (
    <div className="w-full max-w-lg rounded-[24px] overflow-hidden border border-white/5 bg-[#0A0A0A] shadow-2xl font-sans">
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap size={14} className="text-[#0df2df] fill-[#0df2df]" />
          <span className="text-[13px] font-semibold text-white tracking-wide">Live Quote</span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-medium">
          <div className="w-1.5 h-1.5 rounded-full bg-[#0df2df]" />
          <span>Pyth Oracle • 5.0% conf</span>
        </div>
      </div>

      <div className="p-6 space-y-7">
        
        {/* Main Conversion */}
        <div className="flex flex-col items-center justify-center space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-[36px] font-bold text-white tracking-tight leading-none">{amount} <span className="text-[18px] font-medium text-slate-400 ml-1">ETH</span></span>
            <ArrowRight size={24} className="text-[#0df2df]" />
            <span className="text-[36px] font-bold text-[#0df2df] tracking-tight leading-none">~{startSol} <span className="text-[18px] font-medium ml-1">{tokenLabel}</span></span>
          </div>
          <div className="text-[14px] text-slate-500 font-medium tracking-wide">
            on {destLabel}
          </div>
          
          {/* USD Pill */}
          <div className="mt-3 bg-white/[0.03] border border-white/5 rounded-full px-4 py-1.5 flex items-center gap-3 text-[12px] font-medium text-slate-400">
            <span>≈${inputUsd} USD</span>
            <span className="opacity-50">→</span>
            <span>≈${outputUsd} USD</span>
          </div>
        </div>

        {/* Rate & Min Receive Cards */}
        <div className="grid grid-cols-2 gap-4">
          {/* Rate Card */}
          <div className="p-4 rounded-2xl bg-[#0F0F0F] border border-white/5 flex flex-col justify-between">
            <div className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-3">Rate</div>
            <div>
              <div className="text-[16px] font-bold text-white font-mono leading-none mb-1">
                1 ETH = {exchangeRate} {tokenLabel}
              </div>
            </div>
            <div className="text-[11px] text-slate-500 mt-2 font-medium">
              Powered by Pyth Network
            </div>
          </div>
          
          {/* Min Receive Card */}
          <div className="p-4 rounded-2xl bg-[#0F0F0F] border border-green-500/20 flex flex-col justify-between relative overflow-hidden">
            <div className="absolute top-2 right-2 opacity-[0.04]">
              <ShieldCheck size={48} className="text-[#0df2df]" />
            </div>
            <div className="flex items-center gap-1.5 mb-2 relative z-10">
              <ShieldCheck size={14} className="text-green-500" />
              <div className="text-[10px] text-green-500 uppercase tracking-widest font-bold">Min. Receive</div>
              <div className="ml-auto">
                <ShieldCheck size={16} className="text-green-500/30" />
              </div>
            </div>
            <div className="relative z-10">
              <div className="text-[20px] font-bold text-green-400 font-mono leading-none mb-1">
                {floorSol} <span className="text-[13px] font-semibold">{tokenLabel}</span>
              </div>
              <div className="text-[12px] text-slate-400 font-medium mb-3">
                ≈${parseFloat(minOutputUsd) > 0 ? minOutputUsd : (parseFloat(floorSol) * solUsd).toFixed(2)} USD
              </div>
            </div>
            <div className="text-[9px] text-green-500/70 uppercase tracking-widest font-bold relative z-10">
              Guaranteed On-Chain
            </div>
          </div>
        </div>

        <div className="h-px w-full bg-white/5" />

        {/* Duration selector */}
        {onConfirm && !isConfirmed && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Clock size={14} className="text-[#0df2df]" />
                <span className="text-[13px] font-semibold text-white">Auction Duration</span>
              </div>
              <span className="text-[11px] text-slate-500 font-medium">Longer = better rates</span>
            </div>
            <div className="flex gap-2">
              {DURATION_OPTIONS.map((opt) => {
                const isSelected = selectedDuration === opt.seconds;
                return (
                  <button
                    key={opt.seconds}
                    onClick={() => setSelectedDuration(opt.seconds)}
                    className={`flex-1 py-3 rounded-[12px] text-[13px] font-bold transition-all duration-200 ${
                      isSelected 
                        ? 'bg-[#0df2df] text-black shadow-[0_4px_14px_rgba(13,242,223,0.25)] translate-y-[-1px]' 
                        : 'bg-[#0F0F0F] border border-white/5 text-slate-400 hover:bg-[#1A1A1A] hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="h-px w-full bg-white/5" />

        {/* Recipient */}
        {recipientAddress && (
          <div className="space-y-2">
            <div className="text-[11px] text-slate-500 font-medium">Recipient on {destLabel}</div>
            <div className="font-mono text-[13px] text-slate-300 bg-[#0F0F0F] px-4 py-3.5 rounded-xl border border-white/5 truncate select-all">
              {recipientAddress}
            </div>
          </div>
        )}

      </div>

      {/* Footer */}
      {onConfirm && !isConfirmed ? (
        <div className="px-6 pb-6 pt-1">
          <button
            onClick={() => onConfirm?.({ durationSeconds: selectedDuration, startPrice, floorPrice })}
            className="group relative w-full py-4 rounded-[16px] bg-[linear-gradient(135deg,_#0df2df_93%,_#80faf1_93%)] hover:bg-[linear-gradient(135deg,_#33ffff_93%,_#99fbf3_93%)] text-black text-[15px] font-bold transition-all duration-200 active:scale-[0.98] shadow-[0_0_20px_rgba(13,242,223,0.15)] flex items-center justify-center gap-2 overflow-hidden"
          >
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-black/[0.03]" />
            <Check size={18} className="relative z-10 stroke-[3]" />
            <span className="relative z-10">Looks good — prepare my intent</span>
          </button>
        </div>
      ) : isConfirmed ? (
        <div className="px-6 py-5 bg-green-500/10 border-t border-green-500/20 backdrop-blur-md">
          <div className="flex items-center justify-center gap-2.5">
            <div className="size-6 rounded-full bg-green-500/20 flex items-center justify-center relative">
              <div className="absolute inset-0 rounded-full animate-ping bg-green-500/20" />
              <ShieldCheck size={14} className="text-green-400 relative z-10" />
            </div>
            <span className="text-[14px] font-semibold text-green-400 tracking-wide">Plan Confirmed</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
