import { fmtRate } from '@/lib/utils';
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
  auctionDuration: number;
}

export function QuoteInfo({
  quote,
  isLoading,
  error,
  hasValidAmount,
  activeSolvers,
  outputToken,
  quoteAge,
  auctionDuration,
}: QuoteInfoProps) {
  if (!hasValidAmount) return null;
  if (!quote && !isLoading && !error) return null;

  const quoteExpiring = quoteAge !== null && quoteAge > 20;

  return (
    <div className="mt-4 px-2 space-y-3 mb-4">
      {error && (
        <div className="flex items-center gap-2 text-rose-400 text-[13px] py-1">
          <XCircle size={14} strokeWidth={2} />
          {error}
        </div>
      )}

      {quote && !error && (
        <>
          <div className="flex justify-between items-center text-[13px] tracking-wide">
            <span className="text-[#64748b]">Rate</span>
            <span className="text-white font-medium">
              1 ETH ≈ {fmtRate(quote.rate)} {outputToken.toUpperCase()}
            </span>
          </div>

          <div className="flex justify-between items-center text-[13px] tracking-wide">
            <span className="text-[#64748b]">Active solvers</span>
            <span className={`font-medium ${activeSolvers > 0 ? 'text-[#00E599]' : 'text-rose-400'}`}>
              {activeSolvers} {activeSolvers > 0 ? '· competing' : '· none active'}
            </span>
          </div>

          <div className="flex justify-between items-center text-[13px] tracking-wide">
            <span className="text-[#64748b]">Price source</span>
            <div>
              <span className="text-[#cbd5e1]">estimate</span>
              {quoteAge !== null && (
                <span className={`ml-1 ${quoteExpiring ? 'text-amber-400' : 'text-[#64748b]'}`}>
                  · {quoteAge}s ago
                </span>
              )}
            </div>
          </div>

          <div className="flex justify-between items-center text-[13px] tracking-wide">
            <span className="text-[#64748b]">Duration</span>
            <span className="text-[#cbd5e1]">
              Dutch auction <span className="text-[#64748b]">·</span> {auctionDuration} min
            </span>
          </div>
        </>
      )}
    </div>
  );
}
