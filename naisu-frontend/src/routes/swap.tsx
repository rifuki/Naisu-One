import { useState, useEffect, useRef } from 'react';
import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAccount, useConnect, useDisconnect, useSendTransaction } from 'wagmi';
import { useWallet } from '@solana/wallet-adapter-react';
import { useSolanaAddress } from '@/hooks/use-solana-address';
import { useSwapQuote } from '@/features/swap/hooks/use-swap-quote';
import { useSwapOrder } from '@/features/swap/hooks/use-swap-order';
import { useEthBalance } from '@/features/swap/hooks/use-eth-balance';
import { useSolBalance } from '@/features/swap/hooks/use-sol-balance';
import { SwapForm } from '@/features/swap/components/swap-form';
import LiveProgressCard from '@/components/live-progress-card';
import { secondsAgo } from '@/lib/utils';

export const Route = createFileRoute("/swap")({
  component: SwapPage,
});

function SwapPage() {
  const { address: evmAddress, isConnected: evmConnected, connector } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { disconnect: disconnectSolana, wallet: solanaWallet } = useWallet();
  const solanaAddress = useSolanaAddress();

  const [sellAmount, setSellAmount] = useState('');
  const [buyAmount, setBuyAmount] = useState('');
  const [lastEdited, setLastEdited] = useState<'sell' | 'buy'>('sell');
  const latestRate = useRef<number>(0);
  const [inputToken, setInputToken] = useState<'eth' | 'usdc'>('eth');
  const [outputToken, setOutputToken] = useState<'sol' | 'msol'>('sol');
  const [submitted, setSubmitted] = useState<{ txHash: string; submittedAt: number } | null>(null);
  const [tick, setTick] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [pastedDestinationAddress, setPastedDestinationAddress] = useState('');

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

  // Order
  const {
    mutateAsync: submitOrder,
    isPending: isSubmitting,
    error: buildError,
    reset: resetError,
  } = useSwapOrder();

  const { sendTransactionAsync, isPending: isSigning } = useSendTransaction();
  const isBusy = isSubmitting || isSigning;

  // Tick every second for quote age
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const hasValidAmount = Boolean(sellAmount && parseFloat(sellAmount) > 0);
  const activeSolvers = quote?.activeSolvers ?? 0;
  const noSolvers = hasValidAmount && quote && activeSolvers === 0;

  const destAddress = isFlipped ? (evmConnected ? evmAddress : pastedDestinationAddress) : (solanaAddress || pastedDestinationAddress);
  const sourceAddress = isFlipped ? solanaAddress : (evmConnected ? evmAddress : undefined);
  const canSwap = !!sourceAddress && !!destAddress && hasValidAmount && !noSolvers;

  const quoteAge = dataUpdatedAt > 0 ? secondsAgo(dataUpdatedAt) : null;
  const quoteExpiring = quoteAge !== null && quoteAge > 20;

  const handleSwap = async () => {
    if (!sourceAddress || !destAddress || !sellAmount) return;

    resetError();

    try {
      const result = await submitOrder({
        evmAddress: (isFlipped ? destAddress : sourceAddress) as string,
        solanaAddress: (isFlipped ? sourceAddress : destAddress) as string,
        amount: sellAmount,
        outputToken,
      });

      const hash = await sendTransactionAsync({
        to: result.tx.to as `0x${string}`,
        data: result.tx.data as `0x${string}`,
        value: BigInt(result.tx.value),
        chainId: result.tx.chainId,
      });

      setSubmitted({ txHash: hash, submittedAt: Date.now() });
    } catch (err) {
      console.error("Transaction failed:", err);
    }
  };

  const handleReset = () => {
    setSubmitted(null);
    setSellAmount('');
    setBuyAmount('');
    resetError();
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

      <div className="w-full max-w-[420px] relative z-10 space-y-4">
        {/* Swap Form */}
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

        {/* LiveProgressCard — shown after submit */}
        {submitted && evmAddress && (
          <div className="animate-fade-in-up">
            <LiveProgressCard userAddress={evmAddress} txHash={submitted.txHash} submittedAt={submitted.submittedAt} />
            <div className="flex justify-between items-center mt-2 px-1">
              <a
                href={`https://sepolia.basescan.org/tx/${submitted.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1 transition-colors"
              >
                <ExternalLink size={14} strokeWidth={1.5} />
                View on BaseScan
              </a>
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
