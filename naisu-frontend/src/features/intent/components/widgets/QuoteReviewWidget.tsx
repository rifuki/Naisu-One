import { useState } from 'react';
import type { QuoteReviewWidget as QuoteReviewWidgetData } from './types';

const OUTPUT_TOKEN_LABELS: Record<string, string> = {
  sol:  'SOL',
  msol: 'mSOL (Marinade)',
};

const DURATION_LABELS: Record<number, string> = {
  120: '2 min',
  300: '5 min',
  600: '10 min',
};

const DEST_LABELS: Record<string, string> = {
  solana: 'Solana',
  sui:    'Sui',
};

const PRICE_SOURCE_LABELS: Record<string, string> = {
  pyth:      'Pyth Oracle',
  coingecko: 'CoinGecko',
  fallback:  'Estimated',
};

interface Props {
  widget: QuoteReviewWidgetData;
  onConfirm: (outputToken: string, durationSeconds: number) => void;
}

export function QuoteReviewWidget({ widget, onConfirm }: Props) {
  const [selectedToken, setSelectedToken] = useState(widget.defaultOutputToken);
  const [selectedDuration, setSelectedDuration] = useState(widget.defaultDuration);

  const destLabel    = DEST_LABELS[widget.toChain] ?? widget.toChain;
  const fromUsd      = parseFloat(widget.fromUsdValue);
  const toUsd        = parseFloat(widget.toUsdValue);
  const confidence   = widget.confidence != null ? (widget.confidence * 100).toFixed(1) : null;
  const sourceLabel  = PRICE_SOURCE_LABELS[widget.priceSource] ?? widget.priceSource;
  const isLiveOracle = widget.priceSource === 'pyth' || widget.priceSource === 'coingecko';
  const minReceive   = (Number(widget.floorPriceLamports) / 1e9).toFixed(4);

  return (
    <div className="flex flex-col gap-3">
      {/* Solver warning */}
      {widget.solverWarning && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-500/8 border border-amber-500/25">
          <span className="material-symbols-outlined text-amber-400 text-[15px] mt-0.5 shrink-0">warning</span>
          <p className="text-[11px] text-amber-300 leading-snug">{widget.solverWarning}</p>
        </div>
      )}

      <div className="rounded-xl border border-primary/20 bg-primary/5 overflow-hidden">
        {/* Header */}
        <div className="px-4 py-2.5 flex items-center gap-2 bg-primary/8 border-b border-primary/15">
          <span className="material-symbols-outlined text-primary text-[15px]">price_check</span>
          <span className="text-[11px] font-bold text-primary uppercase tracking-[0.1em]">Live Quote</span>
          <div className="ml-auto flex items-center gap-1.5">
            <div className={`size-1.5 rounded-full ${isLiveOracle ? 'bg-green-400 animate-pulse' : 'bg-amber-400'}`} />
            <span className="text-[10px] text-slate-500">{sourceLabel}</span>
            {confidence && (
              <span className="text-[10px] text-slate-600">· {confidence}% conf</span>
            )}
          </div>
        </div>

        {/* Main amount display */}
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center gap-3 mb-1">
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold text-white tabular-nums">{widget.amount}</span>
              <span className="text-sm text-slate-400">ETH</span>
            </div>
            <span className="material-symbols-outlined text-primary/60 text-[18px]">arrow_forward</span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-bold text-primary">~{widget.estimatedReceive}</span>
              <span className="text-sm text-primary/70">{OUTPUT_TOKEN_LABELS[selectedToken] ?? selectedToken}</span>
              <span className="text-xs text-slate-500">on {destLabel}</span>
            </div>
          </div>
          {/* USD equiv */}
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <span className={isNaN(fromUsd) ? 'hidden' : ''}>≈ ${fromUsd.toFixed(2)} USD</span>
            <span className="material-symbols-outlined text-[11px]">arrow_forward</span>
            <span className={isNaN(toUsd) ? 'hidden' : ''}>≈ ${toUsd.toFixed(2)} USD</span>
            {!isNaN(fromUsd) && !isNaN(toUsd) && fromUsd > 0 && (
              <span className="text-slate-600">
                ({((toUsd / fromUsd) * 100).toFixed(1)}% of input)
              </span>
            )}
          </div>
        </div>

        {/* Rate + min receive */}
        <div className="px-4 pb-3 grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1 py-2 px-3 rounded-lg bg-white/3 border border-white/5">
            <span className="text-[9px] text-slate-600 uppercase tracking-wider">Rate</span>
            <span className="text-[11px] font-mono text-slate-300">
              1 ETH = {parseFloat(widget.rate).toFixed(2)} SOL
            </span>
          </div>
          <div className="flex flex-col gap-1 py-2 px-3 rounded-lg bg-green-500/5 border border-green-500/20">
            <div className="flex items-center gap-1">
              <span className="material-symbols-outlined text-green-500 text-[10px]">verified_user</span>
              <span className="text-[9px] text-green-600 uppercase tracking-wider">Min. receive</span>
            </div>
            <span className="text-[11px] font-mono text-green-400 font-semibold">{minReceive} SOL</span>
            <span className="text-[9px] text-green-700">Enforced on-chain</span>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-white/5 mx-4" />

        {/* Selectors */}
        <div className="px-4 py-3 flex flex-col gap-3">
          {/* Output token */}
          {widget.outputTokenOptions.length > 1 && (
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Receive as</p>
              <div className="flex gap-2">
                {widget.outputTokenOptions.map(token => (
                  <button
                    key={token}
                    onClick={() => setSelectedToken(token)}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold border transition-all
                      ${selectedToken === token
                        ? 'bg-primary/20 border-primary/40 text-primary'
                        : 'bg-white/4 border-white/8 text-slate-400 hover:bg-white/8 hover:text-white'
                      }`}
                  >
                    {OUTPUT_TOKEN_LABELS[token] ?? token}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Auction duration */}
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Auction duration</p>
            <div className="flex gap-2">
              {widget.durationOptions.map(dur => (
                <button
                  key={dur}
                  onClick={() => setSelectedDuration(dur)}
                  className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold border transition-all
                    ${selectedDuration === dur
                      ? 'bg-primary/20 border-primary/40 text-primary'
                      : 'bg-white/4 border-white/8 text-slate-400 hover:bg-white/8 hover:text-white'
                    }`}
                >
                  {DURATION_LABELS[dur] ?? `${dur}s`}
                </button>
              ))}
            </div>
            <p className="text-[9px] text-slate-600 mt-1">
              Longer = solver has more time to compete → potentially better price
            </p>
          </div>
        </div>

        {/* Confirm CTA */}
        <div className="px-4 pb-4">
          <button
            onClick={() => onConfirm(selectedToken, selectedDuration)}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl
              bg-primary text-black text-[13px] font-bold
              hover:bg-primary/90 active:scale-[0.98] transition-all
              shadow-[0_0_24px_-4px_rgba(13,242,223,0.5)]"
          >
            <span className="material-symbols-outlined text-[16px]">check_circle</span>
            Looks good — prepare my intent
          </button>
          <p className="text-[10px] text-slate-600 text-center mt-2">
            You'll review the full details before signing anything
          </p>
        </div>
      </div>
    </div>
  );
}
