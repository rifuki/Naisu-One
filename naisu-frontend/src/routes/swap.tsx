import { useState, useEffect, useRef } from 'react';
import { createFileRoute } from "@tanstack/react-router";
import { Button } from '@/components/ui/button';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { useWallet } from '@solana/wallet-adapter-react';
import { useSolanaAddress } from '@/hooks/use-solana-address';
import { useSwapQuote } from '@/features/swap/hooks/use-swap-quote';
import { useSignIntent } from '@/features/intent/hooks/use-sign-intent';
import { useUserNonce } from '@/features/intent/hooks/use-user-nonce';
import { useEthBalance } from '@/features/swap/hooks/use-eth-balance';
import { useSolBalance } from '@/features/swap/hooks/use-sol-balance';
import { SwapForm } from '@/features/swap/components/swap-form';
import LiveProgressCard from '@/components/live-progress-card';
import { useSwapStore, INITIAL_SWAP_PROGRESS } from '@/store/swap-store';
import { secondsAgo } from '@/lib/utils';

// Global cache to persist state across route navigation without full Redux/Zustand overhead
const swapStateCache = {
  sellAmount: '',
  buyAmount: '',
  lastEdited: 'sell' as 'sell' | 'buy',
  inputToken: 'eth' as 'eth' | 'usdc',
  outputToken: 'sol' as 'sol' | 'msol',
  submitted: null as { intentId: string; submittedAt: number } | null,
  isFlipped: false,
  pastedDestinationAddress: '',
};

export const Route = createFileRoute("/swap")({
  component: SwapPage,
});

function SwapPage() {
  const { address: evmAddress, isConnected: evmConnected, connector } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { disconnect: disconnectSolana, wallet: solanaWallet } = useWallet();
  const solanaAddress = useSolanaAddress();

  const setActiveSwap  = useSwapStore((s) => s.setActiveSwap);
  const clearActiveSwap = useSwapStore((s) => s.clearActiveSwap);
  const activeSwap     = useSwapStore((s) => s.activeSwap);

  const [sellAmount, setSellAmount] = useState(swapStateCache.sellAmount);
  const [buyAmount, setBuyAmount] = useState(swapStateCache.buyAmount);
  const [lastEdited, setLastEdited] = useState<'sell' | 'buy'>(swapStateCache.lastEdited);
  const latestRate = useRef<number>(0);
  const [inputToken, setInputToken] = useState<'eth' | 'usdc'>(swapStateCache.inputToken);
  const [outputToken, setOutputToken] = useState<'sol' | 'msol'>(swapStateCache.outputToken);
  const [submitted, setSubmitted] = useState<{ intentId: string; submittedAt: number } | null>(
    swapStateCache.submitted ?? (activeSwap && !activeSwap.isFulfilled ? { intentId: activeSwap.intentId, submittedAt: activeSwap.submittedAt } : null)
  );
  const [isFlipped, setIsFlipped] = useState(swapStateCache.isFlipped);
  const [pastedDestinationAddress, setPastedDestinationAddress] = useState(swapStateCache.pastedDestinationAddress);

  // Sync state to cache
  useEffect(() => {
    swapStateCache.sellAmount = sellAmount;
    swapStateCache.buyAmount = buyAmount;
    swapStateCache.lastEdited = lastEdited;
    swapStateCache.inputToken = inputToken;
    swapStateCache.outputToken = outputToken;
    swapStateCache.submitted = submitted;
    swapStateCache.isFlipped = isFlipped;
    swapStateCache.pastedDestinationAddress = pastedDestinationAddress;
  }, [sellAmount, buyAmount, lastEdited, inputToken, outputToken, submitted, isFlipped, pastedDestinationAddress]);

  const handleFlip = () => {
    setIsFlipped(!isFlipped);
    setSellAmount(buyAmount);
    setBuyAmount(sellAmount);
    setLastEdited(lastEdited === 'sell' ? 'buy' : 'sell');
    setPastedDestinationAddress('');
  };

  // Balances
  const { balance: ethBalance, raw: ethBalanceRaw } = useEthBalance();
  const { balance: solBalance } = useSolBalance(solanaAddress);

  // Quote
  const quoteAmount = sellAmount || '1'; // Default to 1 to lazily grab exchange rate if empty
  const {
    data: quote,
    isLoading: isQuoteLoading,
    isFetching: isQuoteFetching,
    error: quoteError,
    dataUpdatedAt,
    refetch,
  } = useSwapQuote({ 
    amount: quoteAmount,
    fromChain: isFlipped ? 'solana' : 'evm-base',
    toChain: isFlipped ? 'evm-base' : 'solana'
  });

  // 2-way input synchronization
  if (quote && parseFloat(quote.amountIn) > 0) {
    latestRate.current = parseFloat(quote.estimatedReceive) / parseFloat(quote.amountIn);
  }

  const handleSellChange = (val: string) => {
    setSellAmount(val);
    setLastEdited('sell');
    if (!val) setBuyAmount('');
  };

  const handleBuyChange = (val: string) => {
    setBuyAmount(val);
    setLastEdited('buy');
    if (!val) {
      setSellAmount('');
      return;
    }
    if (latestRate.current > 0) {
      const calculatedSell = (parseFloat(val) / latestRate.current).toFixed(6);
      setSellAmount(parseFloat(calculatedSell).toString());
    }
  };

  useEffect(() => {
    if (quote && lastEdited === 'sell' && sellAmount) {
      setBuyAmount(quote.estimatedReceive);
    }
  }, [quote, lastEdited, sellAmount]);

  // Gasless signing
  const { data: nonce } = useUserNonce(evmAddress);
  const {
    mutateAsync: signIntent,
    isPending: isSigning,
    error: buildError,
    reset: resetError,
  } = useSignIntent();
  const isBusy = isSigning;


  const hasValidAmount = Boolean(sellAmount && parseFloat(sellAmount) > 0);
  const activeSolvers = quote?.activeSolvers ?? 0;
  const noSolvers = hasValidAmount && quote && activeSolvers === 0;

  const destAddress = isFlipped ? (evmConnected ? evmAddress : pastedDestinationAddress) : (solanaAddress || pastedDestinationAddress);
  const sourceAddress = isFlipped ? solanaAddress : (evmConnected ? evmAddress : undefined);
  const canSwap = !!sourceAddress && !!destAddress && hasValidAmount && !noSolvers && !!quote;

  const quoteAge = dataUpdatedAt > 0 ? secondsAgo(dataUpdatedAt) : null;

  const handleSwap = async () => {
    if (!sourceAddress || !destAddress || !sellAmount || !quote) return;

    resetError();

    try {
      const result = await signIntent({
        recipientAddress: destAddress as string,
        destinationChain: 'solana',
        amount: sellAmount,
        outputToken: outputToken === 'msol' ? 'msol' : 'sol',
        startPrice: quote.startPrice,
        floorPrice: quote.floorPrice,
        durationSeconds: quote.durationSeconds,
        nonce: nonce ?? 0,
      });

      const now = Date.now();
      setSubmitted({ intentId: result.submissionResult.intentId, submittedAt: now });
      setActiveSwap({
        intentId: result.submissionResult.intentId,
        submittedAt: now,
        progress: INITIAL_SWAP_PROGRESS,
        isFulfilled: false,
      });
    } catch (err) {
      console.error("Swap failed:", err);
    }
  };

  const handleReset = () => {
    setSubmitted(null);
    clearActiveSwap();
    setSellAmount('');
    setBuyAmount('');
    resetError();
    swapStateCache.submitted = null;
  };

  const getSubmitLabel = () => {
    if (!sourceAddress) return `Connect ${isFlipped ? 'Solana' : 'EVM'} Wallet`;
    if (!destAddress) return `Select ${isFlipped ? 'EVM' : 'Solana'} Destination`;
    if (!hasValidAmount) return 'Enter Amount';
    if (noSolvers) return 'No Active Solvers';
    if (isBusy) return 'Processing...';
    return 'Swap';
  };

  return (
    <div className="flex-1 flex items-center justify-center px-4 relative w-full pb-[10vh]">
      {/* Background glows */}
      <div className="absolute top-[20%] left-[15%] w-[400px] h-[400px] bg-teal-500/10 rounded-full blur-[120px] pointer-events-none z-0" />
      <div className="absolute bottom-[20%] right-[15%] w-[500px] h-[500px] bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none z-0" />

      <div className="relative z-10 flex flex-col md:flex-row gap-6 items-start transition-all duration-500 w-full justify-center">
        {/* Left Column: Swap Form */}
        <div className="w-full max-w-[420px] shrink-0 space-y-4 transition-all duration-500">
          <SwapForm
            sellAmount={sellAmount}
            onSellAmountChange={handleSellChange}
            buyAmount={buyAmount}
            onBuyAmountChange={handleBuyChange}
            inputToken={inputToken}
            onInputTokenChange={setInputToken}
            outputToken={outputToken}
            onOutputTokenChange={setOutputToken}
            ethBalance={ethBalance}
            ethBalanceRaw={ethBalanceRaw}
            solBalance={solBalance}
            evmAddress={evmAddress}
            evmConnected={evmConnected}
            evmWalletIcon={connector?.icon}
            evmWalletName={connector?.name}
            solanaAddress={solanaAddress}
            solanaWalletIcon={solanaWallet?.adapter?.icon}
            solanaWalletName={solanaWallet?.adapter?.name}
            quote={quote ?? null}
            isQuoteLoading={isQuoteLoading}
            isQuoteFetching={isQuoteFetching}
            quoteError={quoteError?.message ?? null}
            quoteAge={quoteAge}
            onConnectEvm={() => connect({ connector: connectors[0] })}
            onDisconnectEvm={() => disconnect()}
            onDisconnectSolana={() => disconnectSolana()}
            isConnectingEvm={isConnecting}
            isFlipped={isFlipped}
            onFlip={handleFlip}
            pastedDestinationAddress={pastedDestinationAddress}
            setPastedDestinationAddress={setPastedDestinationAddress}
            onSubmit={handleSwap}
            canSubmit={canSwap}
            isSubmitting={isBusy}
            submitLabel={getSubmitLabel()}
            hasNoSolvers={noSolvers}
            buildError={buildError?.message ?? null}
          />
        </div>

        {/* Right Column: LiveProgressCard — shown after submit */}
        {submitted && evmAddress && (
          <div className="w-full max-w-[420px] shrink-0 animate-in slide-in-from-left-4 fade-in duration-500">
            <LiveProgressCard userAddress={evmAddress} submittedAt={submitted.submittedAt} orderId={submitted.intentId} />
            <div className="flex justify-end items-center mt-2 px-1">
              <Button
                variant="ghost"
                size="auto"
                onClick={handleReset}
                className="text-xs text-primary hover:text-primary/80 font-semibold transition-colors"
              >
                New swap
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* WalletMultiButton style override */}
      <style>{`
        .wallet-adapter-root-override .wallet-adapter-button {
          background: rgba(255, 255, 255, 0.1) !important;
          border: 1px solid rgba(255, 255, 255, 0.05) !important;
          border-radius: 9999px !important;
          padding: 0 16px !important;
          height: 32px !important;
          font-size: 12px !important;
          font-weight: 600 !important;
          color: white !important;
          line-height: 1 !important;
          backdrop-filter: blur(8px) !important;
          font-family: inherit !important;
        }
        .wallet-adapter-root-override .wallet-adapter-button:hover {
          background: rgba(255, 255, 255, 0.15) !important;
        }
        .wallet-adapter-root-override .wallet-adapter-button-start-icon {
          display: none !important;
        }
      `}</style>
    </div>
  );
}
