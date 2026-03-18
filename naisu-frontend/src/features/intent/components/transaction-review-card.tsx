interface DecodedTx {
  amountEth: string;
  destinationLabel: string;
  destinationChain: number;
  recipient: string;
  recipientShort: string;
  startPriceFormatted: string;
  floorPriceFormatted: string;
  durationMin: number;
}

interface PendingTx {
  to: string;
  value: string;
  chainId: number;
  data: string;
  decoded?: DecodedTx;
}

interface TransactionReviewCardProps {
  pendingTx: PendingTx;
  txStatus: string | null;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function TransactionReviewCard({
  pendingTx,
  txStatus,
  onConfirm,
  onDismiss,
}: TransactionReviewCardProps) {
  const d = pendingTx.decoded;

  return (
    <div className="w-full px-4 sm:px-8 relative z-30">
      <div className="max-w-3xl mx-auto">
        <div className="relative rounded-2xl overflow-hidden border border-primary/30 bg-[#070e0c] shadow-[0_0_40px_-8px_rgba(13,242,223,0.2)]">
          <div className="h-px w-full bg-gradient-to-r from-transparent via-primary/70 to-transparent" />

          <div className="flex flex-col">
            {/* Header */}
            <div className="px-5 pt-4 pb-3 flex items-center gap-2 border-b border-white/5">
              <div className="size-6 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-primary" style={{ fontSize: '14px' }}>
                  receipt_long
                </span>
              </div>
              <span className="text-[11px] font-bold text-primary uppercase tracking-[0.12em]">
                Review Transaction
              </span>
              <span className="ml-auto text-[10px] font-mono text-slate-500 bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
                {pendingTx.chainId === 84532 ? 'Base Sepolia' : `Chain ${pendingTx.chainId}`}
              </span>
            </div>

            <div className="flex items-stretch">
              {/* Left: details */}
              <div className="flex-1 px-5 py-4 flex flex-col gap-2.5">
                {d ? (
                  <>
                    {/* Amount row */}
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-[22px] font-bold text-white tabular-nums">{d.amountEth}</span>
                      <span className="text-[13px] text-slate-400 font-medium">ETH</span>
                      <span className="material-symbols-outlined text-slate-600 text-[16px]">arrow_forward</span>
                      <span className="text-[13px] font-semibold text-primary">~SOL</span>
                      <span className="text-[11px] text-slate-500">on {d.destinationLabel}</span>
                    </div>

                    {/* Recipient */}
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/3 border border-white/6">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-slate-500 text-[14px]">
                          account_balance_wallet
                        </span>
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider">Recipient</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] font-mono text-slate-200">{d.recipientShort}</span>
                        <button
                          onClick={() => navigator.clipboard.writeText(d.recipient)}
                          className="text-slate-600 hover:text-primary transition-colors"
                          title={d.recipient}
                        >
                          <span className="material-symbols-outlined text-[12px]">content_copy</span>
                        </button>
                      </div>
                    </div>

                    {/* Auction params */}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="flex flex-col px-2.5 py-2 rounded-lg bg-white/3 border border-white/5">
                        <span className="text-[9px] text-slate-600 uppercase tracking-wider mb-0.5">Start price</span>
                        <span className="text-[11px] font-mono text-slate-300">
                          {parseFloat(d.startPriceFormatted).toFixed(4)}{' '}
                          {d.destinationChain === 1 ? 'SOL' : d.destinationChain === 21 ? 'SUI' : 'ETH'}
                        </span>
                      </div>
                      <div className="flex flex-col px-2.5 py-2 rounded-lg bg-white/3 border border-white/5">
                        <span className="text-[9px] text-slate-600 uppercase tracking-wider mb-0.5">Floor price</span>
                        <span className="text-[11px] font-mono text-slate-300">
                          {parseFloat(d.floorPriceFormatted).toFixed(4)}{' '}
                          {d.destinationChain === 1 ? 'SOL' : d.destinationChain === 21 ? 'SUI' : 'ETH'}
                        </span>
                      </div>
                      <div className="flex flex-col px-2.5 py-2 rounded-lg bg-white/3 border border-white/5">
                        <span className="text-[9px] text-slate-600 uppercase tracking-wider mb-0.5">Auction</span>
                        <span className="text-[11px] font-mono text-slate-300">{d.durationMin} min</span>
                      </div>
                    </div>

                    {/* Contract */}
                    <div className="flex items-center justify-between text-[10px] text-slate-600 pt-0.5">
                      <span>IntentBridge contract</span>
                      <span className="font-mono">
                        {pendingTx.to.slice(0, 8)}…{pendingTx.to.slice(-6)}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-slate-500 w-12 shrink-0">To</span>
                      <span className="text-[12px] font-mono text-slate-300">
                        {pendingTx.to.slice(0, 10)}…{pendingTx.to.slice(-8)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-slate-500 w-12 shrink-0">Value</span>
                      <span className="text-[15px] font-bold text-white">
                        {pendingTx.value}{' '}
                        <span className="text-[11px] text-slate-400 font-normal">ETH</span>
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Divider */}
              <div className="w-px bg-white/5 self-stretch" />

              {/* Right: actions */}
              <div className="flex flex-col justify-center gap-2 px-4 py-4 shrink-0 w-[148px]">
                {txStatus ? (
                  <div className="flex flex-col items-center gap-2 py-2">
                    <div className="size-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    <span className="text-[11px] text-primary/80 text-center leading-tight">{txStatus}</span>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={onConfirm}
                      className="w-full flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-primary text-black text-[12px] font-bold hover:bg-primary/90 active:scale-95 transition-all shadow-[0_0_20px_-4px_rgba(13,242,223,0.6)]"
                    >
                      <span className="material-symbols-outlined text-[14px]">account_balance_wallet</span>
                      Sign & Send
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

export type { PendingTx, DecodedTx };
