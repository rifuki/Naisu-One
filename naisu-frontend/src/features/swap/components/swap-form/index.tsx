import { TokenInput } from './token-input';
import { TokenSelector } from './token-selector';
import { WalletStatus } from './wallet-status';
import { QuoteInfo } from './quote-info';
import type { IntentQuote } from '@/features/intent/api/get-intent-quote';

interface SwapFormProps {
  // Input state
  amount: string;
  onAmountChange: (value: string) => void;
  outputToken: 'sol' | 'msol';
  onOutputTokenChange: (value: 'sol' | 'msol') => void;

  // Balances
  ethBalance: string | null;
  ethBalanceRaw: string;
  solBalance: string | null;

  // Addresses
  evmAddress?: string | null;
  evmConnected: boolean;
  solanaAddress?: string | null;

  // Quote
  quote: IntentQuote | null;
  isQuoteLoading: boolean;
  quoteError: string | null;
  quoteAge: number | null;

  // Wallet actions
  onConnectEvm: () => void;
  isConnectingEvm?: boolean;

  // Submit
  onSubmit: () => void;
  canSubmit: boolean;
  isSubmitting: boolean;
  submitLabel: string;
  hasNoSolvers: boolean;

  // Errors
  buildError?: string | null;
}

export function SwapForm({
  amount,
  onAmountChange,
  outputToken,
  onOutputTokenChange,
  ethBalance,
  ethBalanceRaw,
  solBalance,
  evmAddress,
  evmConnected,
  solanaAddress,
  quote,
  isQuoteLoading,
  quoteError,
  quoteAge,
  onConnectEvm,
  isConnectingEvm,
  onSubmit,
  canSubmit,
  isSubmitting,
  submitLabel,
  hasNoSolvers,
  buildError,
}: SwapFormProps) {
  const hasValidAmount = Boolean(amount && parseFloat(amount) > 0);
  const activeSolvers = quote?.activeSolvers ?? 0;
  const estimatedReceive = quote?.estimatedReceive ?? '0';

  return (
    <div className="glass-panel rounded-2xl p-2 relative before:absolute before:inset-[-1px] before:-z-10 before:rounded-2xl before:bg-gradient-to-br before:from-primary/20 before:to-transparent before:pointer-events-none">
      {/* You send */}
      <TokenInput
        label="You send"
        amount={amount}
        onChange={onAmountChange}
        balance={ethBalance}
        rawBalance={ethBalanceRaw}
        tokenSymbol="ETH"
        chainName="Base Sepolia"
        address={evmAddress}
        tokenIcon={
          <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center shrink-0">
            <span className="text-sm font-bold text-indigo-300">Ξ</span>
          </div>
        }
        usdValue={quote?.fromUsd}
        onMaxClick={() => onAmountChange(ethBalanceRaw)}
      />

      {/* Divider arrow */}
      <div className="relative h-2 flex items-center justify-center z-10 my-1">
        <div className="absolute bg-surface-light border-4 border-[#0e1716] rounded-xl p-2 text-slate-500">
          <span className="material-symbols-outlined text-[18px] block">south</span>
        </div>
      </div>

      {/* You receive */}
      <TokenInput
        label="You receive"
        amount={hasValidAmount && !isQuoteLoading ? parseFloat(estimatedReceive).toFixed(4) : '0'}
        onChange={() => {}}
        balance={solBalance}
        rawBalance={solBalance ?? '0'}
        tokenSymbol={outputToken.toUpperCase()}
        chainName="Solana Devnet"
        address={solanaAddress}
        tokenIcon={
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
              outputToken === 'msol' ? 'bg-blue-500/20' : 'bg-purple-500/20'
            }`}
          >
            <span
              className={`text-sm font-bold ${
                outputToken === 'msol' ? 'text-blue-300' : 'text-purple-300'
              }`}
            >
              {outputToken === 'msol' ? 'm' : '◎'}
            </span>
          </div>
        }
        usdValue={quote?.toUsd}
        isLoading={isQuoteLoading}
        readOnly
      />

      {/* Quote info */}
      <QuoteInfo
        quote={quote}
        isLoading={isQuoteLoading}
        error={quoteError}
        hasValidAmount={hasValidAmount}
        activeSolvers={activeSolvers}
        outputToken={outputToken}
        quoteAge={quoteAge}
      />

      {/* No solvers warning */}
      {hasNoSolvers && (
        <div className="mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-start gap-2">
          <span className="material-symbols-outlined text-sm shrink-0 mt-0.5">warning</span>
          <span>
            No solver is currently active. Your ETH would be locked with no one to fill the order.
            Start a solver or try again later.
          </span>
        </div>
      )}

      {/* Token selector */}
      <TokenSelector value={outputToken} onChange={onOutputTokenChange} />

      {/* Wallet status */}
      <WalletStatus
        evmAddress={evmAddress}
        evmConnected={evmConnected}
        solanaAddress={solanaAddress}
        onConnectEvm={onConnectEvm}
        isConnectingEvm={isConnectingEvm}
      />

      {/* Build error */}
      {buildError && (
        <div className="mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-start gap-2">
          <span className="material-symbols-outlined text-sm shrink-0 mt-0.5">error</span>
          <span>{buildError}</span>
        </div>
      )}

      {/* Swap button */}
      <button
        onClick={!evmConnected ? onConnectEvm : onSubmit}
        disabled={(evmConnected && !canSubmit) || isSubmitting}
        className={`w-full mt-4 font-extrabold text-base py-4 rounded-xl transition-all flex items-center justify-center gap-2
          ${
            hasNoSolvers
              ? 'bg-red-500/20 border border-red-500/30 text-red-400 cursor-not-allowed'
              : canSubmit || !evmConnected
              ? 'bg-gradient-to-r from-teal-400 to-cyan-400 hover:from-teal-300 hover:to-cyan-300 text-black shadow-[0_0_20px_rgba(13,242,223,0.25)]'
              : 'bg-white/5 text-slate-500 cursor-not-allowed'
          }`}
      >
        {isSubmitting && (
          <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
        )}
        {submitLabel}
      </button>
    </div>
  );
}
