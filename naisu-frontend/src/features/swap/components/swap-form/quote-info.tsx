import { fmtRate } from '@/lib/utils';
import type { IntentQuote } from '@/features/intent/api/get-intent-quote';
import { XCircle } from 'lucide-react';

interface QuoteInfoProps {
  quote: IntentQuote | null;
  isLoading: boolean;
  error: string | null;
  hasValidAmount: boolean;
  activeSolvers: number;
  inputToken: string;
  outputToken: string;
  isFlipped?: boolean;
  quoteAge: number | null;
  auctionDuration: number;
  auctionSlippage: number;
}

export function QuoteInfo({
  quote,
  isLoading,
  error,
  hasValidAmount,
  activeSolvers,
  inputToken,
  outputToken,
  isFlipped,
  quoteAge,
  auctionDuration,
  auctionSlippage,
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

      {(isLoading || quote) && !error && (
        <>
          <div className="flex justify-between items-center text-[13px] tracking-wide h-5">
            <span className="text-[#64748b]">Rate</span>
            {isLoading || !quote ? (
              <div className="h-4 w-32 bg-white/5 rounded animate-pulse" />
            ) : (
              <span className="text-white font-medium">
                1 {isFlipped ? outputToken.toUpperCase() : inputToken.toUpperCase()} ≈ {fmtRate(quote.rate)} {isFlipped ? inputToken.toUpperCase() : outputToken.toUpperCase()}
              </span>
            )}
          </div>

          <div className="flex justify-between items-center text-[13px] tracking-wide h-5">
            <span className="text-[#64748b]">Active solvers</span>
            {isLoading || !quote ? (
              <div className="h-4 w-24 bg-white/5 rounded animate-pulse" />
            ) : (
              <span className={`font-medium ${activeSolvers > 0 ? 'text-[#0df2df]' : 'text-rose-400'}`}>
                {activeSolvers} {activeSolvers > 0 ? '· competing' : '· none active'}
              </span>
            )}
          </div>

          <div className="flex justify-between items-center text-[13px] tracking-wide h-5">
            <span className="text-[#64748b]">Best price</span>
            {isLoading || !quote ? (
              <div className="h-4 w-28 bg-white/5 rounded animate-pulse" />
            ) : (
              <span className="text-[#0df2df] font-medium">
                ≈ {parseFloat(quote.estimatedReceive).toFixed(5)} {isFlipped ? inputToken.toUpperCase() : outputToken.toUpperCase()}
              </span>
            )}
          </div>

          <div className="flex justify-between items-center text-[13px] tracking-wide h-5">
            <span className="text-[#64748b]">Floor price (-{auctionSlippage}%)</span>
            {isLoading || !quote ? (
              <div className="h-4 w-28 bg-white/5 rounded animate-pulse" />
            ) : (
              <span className="text-white font-medium">
                {(parseFloat(quote.estimatedReceive) * (1 - auctionSlippage / 100)).toFixed(5)} {isFlipped ? inputToken.toUpperCase() : outputToken.toUpperCase()}
              </span>
            )}
          </div>

          <div className="flex justify-between items-center text-[13px] tracking-wide h-5">
            <span className="text-[#64748b]">Price source</span>
            {isLoading || !quote ? (
              <div className="h-4 w-24 bg-white/5 rounded animate-pulse" />
            ) : (
              <div>
                <span 
                  className="text-[#cbd5e1] flex items-center gap-1.5 cursor-help" 
                  title="The final price will be finalized dynamically by solvers competing during the auction."
                >
                  {quote.priceSource === 'pyth' ? (
                    <>
                      <img src="https://s2.coinmarketcap.com/static/img/coins/64x64/28177.png" alt="Pyth" className="w-[14px] h-[14px] rounded-full grayscale opacity-80" />
                      Pyth Network
                    </>
                  ) : quote.priceSource === 'coingecko' ? (
                    <>
                      <img src="https://static.coingecko.com/s/thumbnail-007177f3eca19695592f0b8b0eabbdae282b54154e1be912285c9034ea6cbaf2.png" alt="CoinGecko" className="w-[14px] h-[14px] rounded-full grayscale opacity-80" />
                      CoinGecko
                    </>
                  ) : (
                    'market estimate'
                  )}
                </span>
              </div>
            )}
          </div>

          <div className="flex justify-between items-center text-[13px] tracking-wide h-5">
            <span className="text-[#64748b]">Duration</span>
            {isLoading || !quote ? (
              <div className="h-4 w-36 bg-white/5 rounded animate-pulse" />
            ) : (
              <span className="text-[#cbd5e1]">
                Dutch auction <span className="text-[#64748b]">·</span> {auctionDuration} min
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
