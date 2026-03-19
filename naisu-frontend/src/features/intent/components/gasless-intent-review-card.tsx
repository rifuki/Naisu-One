import type { SignIntentParams } from '../hooks/use-sign-intent';

interface GaslessIntentReviewCardProps {
  intent: SignIntentParams;
  status: string | null;
  onConfirm: () => void;
  onDismiss: () => void;
  isFailed?: boolean;
  isSuccess?: boolean;
}

const DEST_LABELS: Record<string, string> = {
  solana: 'Solana',
  sui: 'Sui',
};

const OUTPUT_TOKEN_LABELS: Record<string, string> = {
  sol: 'SOL',
  msol: 'mSOL (Marinade)',
  marginfi: 'marginfi',
};

export function GaslessIntentReviewCard({
  intent,
  status,
  onConfirm,
  onDismiss,
  isFailed,
  isSuccess,
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

  const recipientShort =
    intent.recipientAddress.length > 16
      ? `${intent.recipientAddress.slice(0, 8)}...${intent.recipientAddress.slice(-6)}`
      : intent.recipientAddress;

  return (
    <div className="w-full px-4 sm:px-8 relative z-30">
      <div className="max-w-3xl mx-auto">
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
            {/* Header with FREE badge */}
            <div className="px-5 pt-4 pb-3 flex items-center gap-2 border-b border-white/5">
              <div className="size-6 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
                <span
                  className="material-symbols-outlined text-primary"
                  style={{ fontSize: '14px' }}
                >
                  signature
                </span>
              </div>
              <span className="text-[11px] font-bold text-primary uppercase tracking-[0.12em]">
                Sign Intent
              </span>
              {/* FREE Badge */}
              <span className="ml-2 px-2 py-0.5 rounded-full bg-green-500/20 border border-green-500/30 text-green-400 text-[9px] font-bold uppercase tracking-wider animate-pulse">
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
                  <span className="material-symbols-outlined text-slate-600 text-[16px]">
                    arrow_forward
                  </span>
                  <span className="text-[13px] font-semibold text-primary">
                    ~{OUTPUT_TOKEN_LABELS[intent.outputToken] || intent.outputToken}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    on {DEST_LABELS[intent.destinationChain] || intent.destinationChain}
                  </span>
                </div>

                {/* Recipient */}
                <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/3 border border-white/6">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-slate-500 text-[14px]">
                      account_balance_wallet
                    </span>
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">
                      Recipient
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-mono text-slate-200">{recipientShort}</span>
                    <button
                      onClick={() => navigator.clipboard.writeText(intent.recipientAddress)}
                      className="text-slate-600 hover:text-primary transition-colors"
                      title={intent.recipientAddress}
                    >
                      <span className="material-symbols-outlined text-[12px]">content_copy</span>
                    </button>
                  </div>
                </div>

                {/* Auction params */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="flex flex-col px-2.5 py-2 rounded-lg bg-white/3 border border-white/5">
                    <span className="text-[9px] text-slate-600 uppercase tracking-wider mb-0.5">
                      Start price
                    </span>
                    <span className="text-[11px] font-mono text-slate-300">
                      {formatPrice(intent.startPrice)} SOL
                    </span>
                  </div>
                  <div className="flex flex-col px-2.5 py-2 rounded-lg bg-white/3 border border-white/5">
                    <span className="text-[9px] text-slate-600 uppercase tracking-wider mb-0.5">
                      Floor price
                    </span>
                    <span className="text-[11px] font-mono text-slate-300">
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

                {/* Gas cost display */}
                <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-green-500/5 border border-green-500/20">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-green-400 text-[14px]">
                      local_gas_station
                    </span>
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

              {/* Right: actions */}
              <div className="flex flex-col justify-center gap-2 px-4 py-4 shrink-0 w-[148px]">
                {status ? (
                  <div className="flex flex-col items-center gap-2 py-2">
                    {!isFailed && !isSuccess && (
                      <div className="size-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    )}
                    {isFailed && (
                      <span className="material-symbols-outlined text-red-500 text-lg">error</span>
                    )}
                    {isSuccess && (
                      <span className="material-symbols-outlined text-green-500 text-lg">
                        check_circle
                      </span>
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
                    <button
                      onClick={onConfirm}
                      className="w-full flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-primary text-black text-[12px] font-bold hover:bg-primary/90 active:scale-95 transition-all shadow-[0_0_20px_-4px_rgba(13,242,223,0.6)]"
                    >
                      <span className="material-symbols-outlined text-[14px]">signature</span>
                      Sign (Free)
                    </button>
                    <button
                      onClick={onDismiss}
                      className="w-full flex items-center justify-center gap-1 py-2 px-3 rounded-xl bg-white/4 border border-white/8 text-slate-500 text-[11px] hover:bg-white/8 hover:text-slate-300 transition-all"
                    >
                      <span className="material-symbols-outlined text-[13px]">close</span>
                      Dismiss
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export type { GaslessIntentReviewCardProps };
