/**
 * UnifiedIntentCard - Single card that transforms through intent lifecycle
 * 1. Plan Phase: Dutch auction plan with duration selector
 * 2. Sign Phase: Sign intent after confirm
 * 3. Receipt Phase: Progress tracking and fulfillment
 */
import { useState } from 'react';
import { 
  TrendingDown, Clock, ChevronDown, Users, Shield, 
  Wallet, CheckCircle2, Loader2, Link2, Sparkles 
} from 'lucide-react';
import type { SignIntentParams } from '../../hooks/use-sign-intent';

interface ProgressStep {
  key: string;
  label: string;
  detail?: string;
  done: boolean;
  active: boolean;
}

interface UnifiedIntentCardProps {
  // Plan phase props
  startPrice: string;
  floorPrice: string;
  durationSeconds: number;
  destinationChain: string;
  outputToken: string;
  
  // Sign phase props
  intent: SignIntentParams;
  onSign: () => void;
  onCancel: () => void;
  signStatus?: string | null;
  isSigning?: boolean;
  
  // Receipt phase props  
  progress?: ProgressStep[];
  isFulfilled?: boolean;
  fillPrice?: string;
  winnerSolver?: string;
  signedAt?: number;
  fulfilledAt?: number;
}

const DEST_LABELS: Record<string, string> = { solana: 'Solana', sui: 'Sui' };
const OUTPUT_TOKEN_LABELS: Record<string, string> = { sol: 'SOL', msol: 'mSOL', marginfi: 'marginfi SOL' };
const DURATION_OPTIONS = [
  { label: '2 min', seconds: 120 },
  { label: '5 min', seconds: 300 },
  { label: '10 min', seconds: 600 },
];

const STEP_ICONS: Record<string, React.ComponentType<{ className?: string; size?: number }>> = {
  signed: CheckCircle2,
  rfq: Users,
  winner: TrendingDown,
  executing: Link2,
  fulfilled: Sparkles,
};

function formatSol(lamports: string): string {
  try { return (Number(BigInt(lamports)) / 1e9).toFixed(4); } catch { return lamports; }
}

export function UnifiedIntentCard({
  startPrice, floorPrice, durationSeconds: initialDuration,
  destinationChain, outputToken,
  intent, onSign, onCancel, signStatus, isSigning,
  progress, isFulfilled, fillPrice, winnerSolver,
}: UnifiedIntentCardProps) {
  const [phase, setPhase] = useState<'plan' | 'sign' | 'receipt'>('plan');
  const [selectedDuration, setSelectedDuration] = useState(initialDuration);
  const [showDurationPicker, setShowDurationPicker] = useState(false);

  const destLabel = DEST_LABELS[destinationChain] ?? destinationChain;
  const tokenLabel = OUTPUT_TOKEN_LABELS[outputToken] ?? outputToken.toUpperCase();
  const startSol = formatSol(startPrice);
  const floorSol = formatSol(floorPrice);
  const currentOption = DURATION_OPTIONS.find(o => o.seconds === selectedDuration) || DURATION_OPTIONS[1];

  // If external progress/fulfilled state provided, switch to receipt
  if ((progress || isFulfilled) && phase !== 'receipt') {
    // Don't auto-switch to keep it controlled
  }

  const handleConfirmPlan = () => {
    setPhase('sign');
  };

  const handleSign = () => {
    onSign();
    setPhase('receipt');
  };

  // === PLAN PHASE ===
  if (phase === 'plan') {
    return (
      <div className="rounded-xl overflow-hidden border border-primary/20 bg-[#0a1310] shadow-lg max-w-sm">
        <div className="px-4 py-2.5 bg-primary/5 border-b border-primary/10 flex items-center gap-2">
          <TrendingDown className="text-primary" size={14} />
          <span className="text-[11px] font-medium text-primary">Dutch Auction Plan</span>
          <span className="ml-auto text-[10px] text-slate-500">{intent.amount} ETH → {destLabel}</span>
        </div>

        <div className="p-4 space-y-4">
          {/* Conversion */}
          <div className="text-center">
            <div className="text-2xl font-bold text-white">{startSol} - {floorSol}</div>
            <div className="text-sm text-primary">{tokenLabel}</div>
            <div className="text-[10px] text-slate-500 mt-1">Price decays from start to floor</div>
          </div>

          {/* Pricing */}
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2.5 rounded-lg bg-green-500/5 border border-green-500/20">
              <div className="text-[10px] text-green-500/80">Best case</div>
              <div className="text-sm font-semibold text-green-400">{startSol}</div>
            </div>
            <div className="p-2.5 rounded-lg bg-white/5 border border-white/10">
              <div className="text-[10px] text-slate-500">Worst case</div>
              <div className="text-sm font-semibold text-slate-300">{floorSol}</div>
            </div>
          </div>

          {/* Duration selector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-300 flex items-center gap-1.5">
                <Clock size={12} className="text-primary" />
                Duration
              </span>
              <button
                onClick={() => setShowDurationPicker(!showDurationPicker)}
                className="flex items-center gap-1 px-2 py-1 rounded bg-primary/10 text-primary text-[11px]"
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
                    className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium ${
                      selectedDuration === opt.seconds ? 'bg-primary text-black' : 'bg-white/5 text-slate-400'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Recipient */}
          <div className="pt-2 border-t border-white/5">
            <div className="text-[10px] text-slate-500 mb-1">Recipient</div>
            <code className="block font-mono text-[11px] text-slate-300 bg-black/40 px-2 py-1.5 rounded border border-white/10 overflow-x-auto">
              {intent.recipientAddress}
            </code>
          </div>
        </div>

        <div className="px-4 py-3 bg-primary/5 border-t border-primary/20 space-y-2">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
            <Shield size={10} className="text-green-500" />
            <span>Floor price guaranteed on-chain</span>
          </div>
          <button
            onClick={handleConfirmPlan}
            className="w-full py-2.5 rounded-lg bg-primary hover:bg-primary/90 text-black text-sm font-semibold"
          >
            Confirm Plan
          </button>
        </div>
      </div>
    );
  }

  // === SIGN PHASE ===
  if (phase === 'sign') {
    return (
      <div className="rounded-xl overflow-hidden border border-primary/20 bg-[#0a1310] shadow-lg max-w-sm">
        <div className="px-4 py-2.5 bg-primary/5 border-b border-primary/10 flex items-center gap-2">
          <Wallet className="text-primary" size={14} />
          <span className="text-[11px] font-medium text-primary">Sign Intent</span>
          <span className="ml-auto px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 text-[10px] font-medium">FREE</span>
        </div>

        <div className="p-4 space-y-4">
          <div className="text-center">
            <div className="text-lg text-slate-300">Bridge</div>
            <div className="text-2xl font-bold text-white">{intent.amount} ETH</div>
            <div className="text-sm text-slate-400">→</div>
            <div className="text-xl font-semibold text-primary">{floorSol} - {startSol} {tokenLabel}</div>
          </div>

          <div className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-2">
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-500">Duration</span>
              <span className="text-slate-300">{currentOption.label}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-500">Recipient</span>
              <code className="text-slate-300">{intent.recipientAddress.slice(0, 8)}...{intent.recipientAddress.slice(-6)}</code>
            </div>
          </div>

          {signStatus && (
            <div className="text-[11px] text-primary text-center">{signStatus}</div>
          )}
        </div>

        <div className="px-4 py-3 bg-primary/5 border-t border-primary/20 flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSign}
            disabled={isSigning}
            className="flex-1 py-2 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-50 text-black text-sm font-semibold flex items-center justify-center gap-2"
          >
            {isSigning ? <Loader2 size={14} className="animate-spin" /> : null}
            Sign
          </button>
        </div>
      </div>
    );
  }

  // === RECEIPT PHASE ===
  const currentProgress = progress || [];
  const isComplete = isFulfilled || currentProgress.every(p => p.done);

  return (
    <div className={`rounded-xl overflow-hidden border shadow-lg max-w-sm ${
      isComplete ? 'border-green-500/30 bg-[#051405]' : 'border-primary/20 bg-[#0a1310]'
    }`}>
      <div className={`px-4 py-2.5 border-b flex items-center gap-2 ${
        isComplete ? 'bg-green-500/10 border-green-500/20' : 'bg-primary/5 border-primary/10'
      }`}>
        {isComplete ? <CheckCircle2 className="text-green-400" size={14} /> : <Loader2 className="text-primary animate-spin" size={14} />}
        <span className={`text-[11px] font-medium ${isComplete ? 'text-green-400' : 'text-primary'}`}>
          {isComplete ? 'Intent Fulfilled' : 'Processing Intent'}
        </span>
      </div>

      <div className="p-4 space-y-4">
        {/* Amount */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] text-slate-500">Sent</div>
            <div className="text-lg font-bold text-white">{intent.amount} ETH</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-slate-500">Received</div>
            <div className={`text-lg font-bold ${isComplete ? 'text-green-400' : 'text-primary'}`}>
              {fillPrice ? formatSol(fillPrice) : '~' + floorSol} {tokenLabel}
            </div>
          </div>
        </div>

        {/* Progress */}
        <div className="space-y-2">
          {currentProgress.map((step, idx) => {
            const Icon = STEP_ICONS[step.key] || CheckCircle2;
            return (
              <div key={step.key} className="flex items-center gap-3">
                <div className="w-5 flex justify-center">
                  {step.done ? (
                    <CheckCircle2 className="text-green-400" size={14} />
                  ) : step.active ? (
                    <Loader2 className="text-primary animate-spin" size={14} />
                  ) : (
                    <div className="w-3 h-3 rounded-full bg-slate-700" />
                  )}
                </div>
                <span className={`text-[11px] ${step.done ? 'text-green-400' : step.active ? 'text-primary' : 'text-slate-500'}`}>
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>

        {winnerSolver && (
          <div className="pt-2 border-t border-white/5 text-[11px] text-slate-400">
            Filled by <span className="text-slate-200">{winnerSolver}</span>
          </div>
        )}
      </div>
    </div>
  );
}
