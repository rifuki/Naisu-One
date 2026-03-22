import { useState, useEffect } from 'react';
import { createFileRoute } from "@tanstack/react-router";
import { Button } from '@/components/ui/button';
import { useAccount, useConnect, useDisconnect, useSendTransaction } from 'wagmi';
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
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const solanaAddress = useSolanaAddress();

  const [amount, setAmount] = useState('');
  const [outputToken, setOutputToken] = useState<'sol' | 'msol'>('sol');
  const [submitted, setSubmitted] = useState<{ txHash: string; submittedAt: number } | null>(null);
  const [tick, setTick] = useState(0);

  // Balances
  const { balance: ethBalance, raw: ethBalanceRaw } = useEthBalance();
  const { balance: solBalance } = useSolBalance(solanaAddress);

  // Quote
  const {
    data: quote,
    isLoading: isQuoteLoading,
    error: quoteError,
    dataUpdatedAt,
    refetch,
  } = useSwapQuote({ amount });

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

  const hasValidAmount = Boolean(amount && parseFloat(amount) > 0);
  const activeSolvers = quote?.activeSolvers ?? 0;
  const noSolvers = hasValidAmount && quote && activeSolvers === 0;
  const canSwap = evmConnected && !!solanaAddress && hasValidAmount && !noSolvers;

  const quoteAge = dataUpdatedAt > 0 ? secondsAgo(dataUpdatedAt) : null;
  const quoteExpiring = quoteAge !== null && quoteAge > 20;

  const handleSwap = async () => {
    if (!evmAddress || !solanaAddress || !amount) return;

    resetError();

    try {
      const result = await submitOrder({
        evmAddress,
        solanaAddress,
        amount,
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
    setAmount('');
    resetError();
  };

  const getSubmitLabel = () => {
    if (!evmConnected) return 'Connect EVM Wallet';
    if (!solanaAddress) return 'Connect Solana Wallet';
    if (!hasValidAmount) return 'Enter Amount';
    if (noSolvers) return 'No Active Solvers';
    if (isBusy) return 'Processing...';
    return 'Swap via Intent →';
  };

  return (
    <div className="flex items-center justify-center min-h-[80vh] px-4 relative">
      {/* Background glows */}
      <div className="absolute top-[20%] left-[25%] w-96 h-96 bg-primary/5 rounded-full blur-[100px] pointer-events-none z-0" />
      <div className="absolute bottom-[20%] right-[25%] w-[500px] h-[500px] bg-indigo-600/5 rounded-full blur-[120px] pointer-events-none z-0" />

      <div className="w-full max-w-md relative z-10 space-y-3">
        {/* Header */}
        <div className="flex justify-between items-center px-1">
          <div>
            <h1 className="text-xl font-bold text-white">Cross-chain Swap</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {`ETH on Base Sepolia → ${outputToken.toUpperCase()} on Solana · via Intent Bridge`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {evmConnected && (
              <Button
                variant="ghost"
                size="auto"
                type="button"
                onClick={() => disconnect()}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                {evmAddress?.slice(0, 6)}…{evmAddress?.slice(-4)}
              </Button>
            )}
            {quoteAge !== null && (
              <Button
                variant="ghost"
                size="auto"
                onClick={() => refetch()}
                title="Refresh quote"
                className={`p-1.5 rounded-full transition-all ${
                  quoteExpiring
                    ? 'text-amber-400 hover:text-amber-300 animate-pulse'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">refresh</span>
              </Button>
            )}
          </div>
        </div>

        {/* Swap Form */}
        <SwapForm
          amount={amount}
          onAmountChange={setAmount}
          outputToken={outputToken}
          onOutputTokenChange={setOutputToken}
          ethBalance={ethBalance}
          ethBalanceRaw={ethBalanceRaw}
          solBalance={solBalance}
          evmAddress={evmAddress}
          evmConnected={evmConnected}
          solanaAddress={solanaAddress}
          quote={quote ?? null}
          isQuoteLoading={isQuoteLoading}
          quoteError={quoteError?.message ?? null}
          quoteAge={quoteAge}
          onConnectEvm={() => connect({ connector: connectors[0] })}
          isConnectingEvm={isConnecting}
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
                <span className="material-symbols-outlined text-[14px]">open_in_new</span>
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
        .wallet-adapter-button-override .wallet-adapter-button {
          background: transparent !important;
          border: none !important;
          padding: 0 !important;
          height: auto !important;
          font-size: 12px !important;
          font-weight: 600 !important;
          color: rgb(13 242 223) !important;
          line-height: 1 !important;
        }
        .wallet-adapter-button-override .wallet-adapter-button:hover {
          background: transparent !important;
          opacity: 0.8;
        }
        .wallet-adapter-button-override .wallet-adapter-button-start-icon {
          display: none !important;
        }
      `}</style>
    </div>
  );
}
