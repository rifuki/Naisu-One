import { fmtRate, secondsAgo } from '@/lib/utils';
import type { IntentQuote } from '@/features/intent/api/get-intent-quote';
import { XCircle } from 'lucide-react';

interface QuoteInfoProps {
  quote: IntentQuote | null;
  isLoading: boolean;
  error: string | null;
  hasValidAmount: boolean;
  activeSolvers: number;
  outputToken: string;
  quoteAge: number | null;
}

export function QuoteInfo({
  quote,
  isLoading,
  error,
  hasValidAmount,
  activeSolvers,
  outputToken,
  quoteAge,
}: QuoteInfoProps) {
  if (!hasValidAmount) return null;
  if (!quote && !isLoading && !error) return null;

  const quoteExpiring = quoteAge !== null && quoteAge > 20;

  return (
    <div className="mt-2 px-1 space-y-1.5">
      {error && (
        <div className="flex items-center gap-2 text-red-400 text-xs py-1">
          <XCircle size={14} strokeWidth={1.5} />
          {error}
        </div>
      )}

      {quote && !error && (
        <>
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Rate</span>
            <span className="text-slate-300 font-medium">
              1 ETH ≈ {fmtRate(quote.rate)} {outputToken.toUpperCase()}
            </span>
          </div>

          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Active solvers</span>
            <span className={`font-medium ${activeSolvers > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {activeSolvers} {activeSolvers > 0 ? '· competing' : '· none active'}
            </span>
          </div>

          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Price source</span>
            <span className="text-slate-400">
              {quote.priceSource === 'pyth'
                ? '⚡ Pyth Network'
                : quote.priceSource === 'coingecko'
                ? '🦎 CoinGecko'
                : 'estimate'}
              {quoteAge !== null && (
                <span className={`ml-2 ${quoteExpiring ? 'text-amber-400' : 'text-slate-600'}`}>
                  · {quoteAge}s ago
                </span>
              )}
            </span>
          </div>

          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Duration</span>
            <span className="text-slate-400">
              Dutch auction · {Math.round((quote.durationMs ?? 1800000) / 60000)} min
            </span>
          </div>

          {quote.confidence !== null && quote.confidence > 1 && (
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Confidence</span>
              <span className="text-amber-400">±{quote.confidence.toFixed(2)}% spread</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
