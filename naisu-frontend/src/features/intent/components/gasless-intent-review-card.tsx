import type { SignIntentParams } from '../hooks/use-sign-intent';
import { Button } from '@/components/ui/button';
import { ShieldCheck, ArrowRight, Wallet, Copy, Fuel, CheckCircle2, XCircle, Check, PenLine, X } from 'lucide-react';

interface ProgressStep {
  key: string
  label: string
  detail?: string
  done: boolean
  active: boolean
}

interface GaslessIntentReviewCardProps {
  intent: SignIntentParams;
  status: string | null;
  onConfirm: () => void;
  onDismiss: () => void;
  isFailed?: boolean;
  isSuccess?: boolean;
  progress?: ProgressStep[] | null;
  /** When true, renders without outer px padding (for embedding in chat message list) */
  embedded?: boolean;
  /** When true, shows permanent FULFILLED receipt state — card never disappears */
  fulfilled?: boolean;
  /** Actual SOL received (lamports string from quotedPrice) */
  fillPrice?: string;
  /** Solver name that filled the intent */
  winnerSolver?: string;
  /** Timestamp when user signed (ms) */
  signedAt?: number;
  /** Timestamp when fulfilled (ms) */
  fulfilledAt?: number;
}

const DEST_LABELS: Record<string, string> = {
  solana: 'Solana',
  sui: 'Sui',
};

const OUTPUT_TOKEN_LABELS: Record<string, string> = {
  sol:      'SOL',
  msol:     'mSOL (Marinade)',
  marginfi: 'marginfi SOL',
  jito:     'jitoSOL',
  jupsol:   'jupSOL',
  kamino:   'kSOL',
};

export function GaslessIntentReviewCard({
  intent,
  status,
  onConfirm,
  onDismiss,
  isFailed,
  isSuccess,
  progress,
  embedded,
  fulfilled,
  fillPrice,
  winnerSolver,
  signedAt,
  fulfilledAt,
}: GaslessIntentReviewCardProps) {
  // Format prices from lamports/gwei to human-readable
  const formatPrice = (lamports: string) => {
    const val = BigInt(lamports);
    const decimals = 9; // Solana uses 9 decimals
    const str = val.toString().padStart(decimals + 1, '0');
    const intPart = str.slice(0, -decimals) || '0';
    const fracPart = str.slice(-decimals).replace(/0+$/, '').slice(0, 4);
    return fracPart ? `${intPart}.${fracPart}` : intPart;
  };

  // Calculate fill time in seconds
  const getFillTime = () => {
    if (!signedAt || !fulfilledAt) return undefined;
    const seconds = Math.round((fulfilledAt - signedAt) / 1000);
    return seconds < 60 ? `~${seconds}s` : `~${Math.round(seconds / 60)}m ${seconds % 60}s`;
  };

  // Calculate comparison vs floor
  const getComparisonText = () => {
    if (!fillPrice || !intent.floorPrice) return undefined;
    const fill = parseFloat(fillPrice);
    const floor = parseFloat(formatPrice(intent.floorPrice));
    if (floor === 0) return undefined;
    const diff = ((fill - floor) / floor) * 100;
    const sign = diff >= 0 ? '+' : '';
    return `vs floor ${sign}${diff.toFixed(1)}%`;
  };

  const recipientShort =
    intent.recipientAddress.length > 16
      ? `${intent.recipientAddress.slice(0, 8)}...${intent.recipientAddress.slice(-6)}`
      : intent.recipientAddress;

  return (
    <div className={embedded ? 'w-full' : 'w-full px-4 sm:px-8 relative z-30'}>
      <div className={embedded ? 'w-full' : 'max-w-3xl mx-auto'}>
        <div
          className={`relative rounded-2xl overflow-hidden transition-colors border ${
            isFailed
              ? 'border-red-500/50 bg-[#140505] shadow-[0_0_40px_-8px_rgba(239,68,68,0.2)]'
              : isSuccess
              ? 'border-green-500/50 bg-[#051405] shadow-[0_0_40px_-8px_rgba(34,197,94,0.2)]'
              : 'border-primary/30 bg-[#070e0c] shadow-[0_0_40px_-8px_rgba(13,242,223,0.2)]'
          }`}
        >
          <div
            className={`h-px w-full bg-gradient-to-r from-transparent to-transparent ${
              isFailed ? 'via-red-500/70' : isSuccess ? 'via-green-500/70' : 'via-primary/70'
            }`}
          />

          <div className="flex flex-col">
            {/* Fulfilled receipt banner */}
            {fulfilled && (
              <div className="px-5 py-2 flex items-center gap-2 bg-green-500/10 border-b border-green-500/20">
                <ShieldCheck size={16} strokeWidth={1.5} className="text-green-400" />
                <span className="text-[11px] font-bold text-green-400 uppercase tracking-[0.1em]">Fulfilled — Receipt</span>
                <span className="ml-auto text-[10px] text-green-500/60">Permanent record</span>
              </div>
            )}
            {/* Header with FREE badge */}
            <div className="px-5 pt-4 pb-3 flex items-center gap-2 border-b border-white/5">
              <div className={`size-6 rounded-lg flex items-center justify-center shrink-0 ${fulfilled ? 'bg-green-500/15 border border-green-500/20' : 'bg-primary/15 border border-primary/20'}`}>
                {fulfilled
                  ? <CheckCircle2 size={14} strokeWidth={1.5} className="text-green-400" />
                  : <PenLine size={14} strokeWidth={1.5} className="text-primary" />
                }
              </div>
              <span className={`text-[11px] font-bold uppercase tracking-[0.12em] ${fulfilled ? 'text-green-400' : 'text-primary'}`}>
                {fulfilled ? 'Intent Fulfilled' : 'Sign Intent'}
              </span>
              {/* FREE Badge */}
              <span className={`ml-2 px-2 py-0.5 rounded-full text-green-400 text-[9px] font-bold uppercase tracking-wider ${fulfilled ? 'bg-green-500/20 border border-green-500/30' : 'bg-green-500/20 border border-green-500/30 animate-pulse'}`}>
                FREE - No Gas
              </span>
              <span className="ml-auto text-[10px] font-mono text-slate-500 bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
                Base Sepolia
              </span>
            </div>

            <div className="flex items-stretch">
              {/* Left: details */}
              <div className="flex-1 px-5 py-4 flex flex-col gap-2.5">
                {/* Amount row */}
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-[22px] font-bold text-white tabular-nums">
                    {intent.amount}
                  </span>
                  <span className="text-[13px] text-slate-400 font-medium">ETH</span>
                  <ArrowRight size={16} strokeWidth={1.5} className="text-slate-600" />
                  {fulfilled && fillPrice ? (
                    <>
                      <span className="text-[22px] font-bold text-green-400 tabular-nums">
                        {fillPrice}
                      </span>
                      <span className="text-[13px] font-semibold text-green-400">
                        {OUTPUT_TOKEN_LABELS[intent.outputToken] || intent.outputToken}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-[13px] font-semibold text-primary">
                        ~{formatPrice(intent.startPrice)} {OUTPUT_TOKEN_LABELS[intent.outputToken] || intent.outputToken}
                      </span>
                    </>
                  )}
                  <span className="text-[11px] text-slate-500">
                    on {DEST_LABELS[intent.destinationChain] || intent.destinationChain}
                  </span>
                </div>

                {/* Recipient */}
                <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/3 border border-white/6">
                  <div className="flex items-center gap-2">
                    <Wallet size={14} strokeWidth={1.5} className="text-slate-500" />
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">
                      Recipient
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-mono text-slate-200">{recipientShort}</span>
                    <Button
                      onClick={() => navigator.clipboard.writeText(intent.recipientAddress)}
                      className="text-slate-600 hover:text-primary transition-colors"
                      title={intent.recipientAddress}
                    >
                      <Copy size={12} strokeWidth={1.5} />
                    </Button>
                  </div>
                </div>

                {/* Fulfilled state: YOU RECEIVED hero + details */}
                {fulfilled ? (
                  <div className="flex flex-col gap-3">
                    {/* YOU RECEIVED hero */}
                    <div className="flex flex-col items-center justify-center py-4 px-4 rounded-xl bg-green-500/10 border border-green-500/30">
                      <span className="text-[10px] text-green-400/80 uppercase tracking-[0.15em] mb-1">You Received</span>
                      <div className="flex items-baseline gap-2">
                        <span className="text-[32px] font-bold text-green-400 tabular-nums leading-none">
                          {fillPrice || formatPrice(intent.floorPrice)}
                        </span>
                        <span className="text-[14px] font-semibold text-green-400">{OUTPUT_TOKEN_LABELS[intent.outputToken] ?? intent.outputToken.toUpperCase()}</span>
                      </div>
                      {getComparisonText() && (
                        <span className="text-[11px] text-green-400/70 mt-1">{getComparisonText()}</span>
                      )}
                    </div>
                    
                    {/* Solver + Fill time row */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col px-3 py-2.5 rounded-lg bg-white/3 border border-white/5">
                        <span className="text-[9px] text-slate-600 uppercase tracking-wider mb-0.5">Filled by</span>
                        <span className="text-[12px] font-semibold text-slate-200">{winnerSolver || 'Unknown'}</span>
                      </div>
                      <div className="flex flex-col px-3 py-2.5 rounded-lg bg-white/3 border border-white/5">
                        <span className="text-[9px] text-slate-600 uppercase tracking-wider mb-0.5">Fill time</span>
                        <span className="text-[12px] font-semibold text-slate-200">{getFillTime() || '—'}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Auction params - only show when not fulfilled */
                  <div className="grid grid-cols-3 gap-2">
                    <div className="flex flex-col px-2.5 py-2 rounded-lg bg-white/3 border border-white/5">
                      <span className="text-[9px] text-slate-600 uppercase tracking-wider mb-0.5">
                        Start price
                      </span>
                      <span className="text-[11px] font-mono text-slate-300">
                        {formatPrice(intent.startPrice)} SOL
                      </span>
                    </div>
                    <div className="flex flex-col px-2.5 py-2 rounded-lg bg-green-500/5 border border-green-500/20">
                      <div className="flex items-center gap-1 mb-0.5">
                        <ShieldCheck size={10} strokeWidth={1.5} className="text-green-500" />
                        <span className="text-[9px] text-green-600 uppercase tracking-wider">Min. receive</span>
                      </div>
                      <span className="text-[11px] font-mono text-green-400 font-semibold">
                        {formatPrice(intent.floorPrice)} SOL
                      </span>
                    </div>
                    <div className="flex flex-col px-2.5 py-2 rounded-lg bg-white/3 border border-white/5">
                      <span className="text-[9px] text-slate-600 uppercase tracking-wider mb-0.5">
                        Auction
                      </span>
                      <span className="text-[11px] font-mono text-slate-300">
                        {Math.round(intent.durationSeconds / 60)} min
                      </span>
                    </div>
                  </div>
                )}

                {/* Gas cost display */}
                <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-green-500/5 border border-green-500/20">
                  <div className="flex items-center gap-2">
                    <Fuel size={14} strokeWidth={1.5} className="text-green-400" />
                    <span className="text-[10px] text-green-400 uppercase tracking-wider font-medium">
                      Network Fee
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-bold text-green-400">FREE</span>
                    <span className="text-[10px] text-green-500/70">(Solver pays)</span>
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div className="w-px bg-white/5 self-stretch" />

              {/* Right: progress stepper or actions */}
              {progress ? (
                <div className="flex flex-col px-5 py-4 shrink-0 w-[200px]">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Progress</div>
                  <div className="relative">
                    {progress.map((step, idx) => {
                      const isLast = idx === progress.length - 1;
                      const showConnector = !isLast;
                      
                      return (
                        <div key={step.key} className="relative flex gap-3">
                          {/* Timeline column with dot and connector */}
                          <div className="flex flex-col items-center shrink-0">
                            {/* Dot/Icon */}
                            <div className="relative z-10">
                              {step.done ? (
                                <div className="size-6 rounded-full bg-green-500/20 border border-green-500/40 flex items-center justify-center">
                                  <Check size={14} strokeWidth={1.5} className="text-green-400" />
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
                            {/* Connector line */}
                            {showConnector && (
                              <div 
                                className={`w-px flex-1 min-h-[24px] ${
                                  step.done ? 'bg-green-500/40' : 'bg-white/10'
                                }`}
                                style={{ marginTop: '4px' }}
                              />
                            )}
                          </div>
                          
                          {/* Step content */}
                          <div className={`flex flex-col pb-3 ${isLast ? '' : ''}`}>
                            <span className={`text-[11px] font-medium leading-tight ${
                              step.done ? 'text-green-400' : step.active ? 'text-primary' : 'text-slate-500'
                            }`}>
                              {step.label}
                            </span>
                            {step.detail && (
                              <span className="text-[9px] text-slate-500 mt-0.5 leading-tight">
                                {step.detail}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col justify-center gap-2 px-4 py-4 shrink-0 w-[148px]">
                  {status ? (
                    <div className="flex flex-col items-center gap-2 py-2">
                      {!isFailed && !isSuccess && (
                        <div className="size-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      )}
                      {isFailed && (
                        <XCircle size={18} strokeWidth={1.5} className="text-red-500" />
                      )}
                      {isSuccess && (
                        <CheckCircle2 size={18} strokeWidth={1.5} className="text-green-500" />
                      )}
                      <span
                        className={`text-[11px] text-center leading-tight ${
                          isFailed
                            ? 'text-red-400 font-medium'
                            : isSuccess
                            ? 'text-green-400 font-medium'
                            : 'text-primary/80'
                        }`}
                      >
                        {status}
                      </span>
                    </div>
                  ) : (
                    <>
                      <Button
                        onClick={onConfirm}
                        className="w-full flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-primary text-black text-[12px] font-bold hover:bg-primary/90 active:scale-95 transition-all shadow-[0_0_20px_-4px_rgba(13,242,223,0.6)]"
                      >
                        <PenLine size={14} strokeWidth={1.5} />
                        Sign (Free)
                      </Button>
                      <Button
                        onClick={onDismiss}
                        className="w-full flex items-center justify-center gap-1 py-2 px-3 rounded-xl bg-white/4 border border-white/8 text-slate-500 text-[11px] hover:bg-white/8 hover:text-slate-300 transition-all"
                      >
                        <X size={13} strokeWidth={1.5} />
                        Dismiss
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export type { GaslessIntentReviewCardProps };
