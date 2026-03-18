import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAccount, useConnect, useDisconnect, useBalance } from 'wagmi';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PublicKey } from '@solana/web3.js';
import { useSolanaAddress } from '@/hooks/useSolanaAddress';
import { useIntentQuote } from '@/hooks/useIntentQuote';
import { useCreateOrder } from '@/hooks/useCreateOrder';
import SolverAuctionCard from '@/components/SolverAuctionCard';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtRate(rate: number | null): string {
  if (rate === null) return '—';
  return rate >= 1000
    ? rate.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : rate.toFixed(4).replace(/\.?0+$/, '');
}

function fmtUsd(usd: number | null): string {
  if (usd === null) return '';
  return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function secondsAgo(ts: number): number {
  return Math.floor((Date.now() - ts) / 1000);
}

// ── Component ─────────────────────────────────────────────────────────────────

const SwapPage: React.FC = () => {
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const solanaAddress = useSolanaAddress();

  const [amount, setAmount] = useState('');
  const [withStake, setWithStake] = useState(false);
  const [submitted, setSubmitted] = useState<{ txHash: string; submittedAt: number } | null>(null);

  // ETH balance (wagmi, auto-refreshes on block)
  const { data: ethBalanceData } = useBalance({ address: evmAddress, chainId: 84532 });
  const ethBalanceFmt = ethBalanceData
    ? (Number(ethBalanceData.value) / 10 ** ethBalanceData.decimals).toFixed(4)
    : null;
  const ethBalanceRaw = ethBalanceData
    ? (Number(ethBalanceData.value) / 10 ** ethBalanceData.decimals).toString()
    : '';

  // SOL balance (manual fetch + 15s poll)
  const { connection } = useConnection();
  const [solBalance, setSolBalance] = useState<string | null>(null);
  const fetchSolBalance = useCallback(async () => {
    if (!solanaAddress) { setSolBalance(null); return; }
    try {
      const lamports = await connection.getBalance(new PublicKey(solanaAddress));
      setSolBalance((lamports / 1e9).toFixed(4));
    } catch { /* ignore */ }
  }, [connection, solanaAddress]);

  useEffect(() => {
    fetchSolBalance();
    const id = setInterval(fetchSolBalance, 15_000);
    return () => clearInterval(id);
  }, [fetchSolBalance]);

  // Tick every second for quote age countdown
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const { quote, isLoading: isQuoteLoading, error: quoteError, lastFetch, refresh } = useIntentQuote(amount);
  const { submit, isBuilding, isSigning, isBusy, error: buildError, clearError } = useCreateOrder();

  const hasValidAmount = Boolean(amount && parseFloat(amount) > 0);
  const activeSolvers = quote?.activeSolvers ?? 0;
  const noSolvers = hasValidAmount && quote && activeSolvers === 0;
  const canSwap = evmConnected && !!solanaAddress && hasValidAmount && !isBusy && !noSolvers;

  const inputRef = useRef<HTMLInputElement>(null);

  const handleSwap = async () => {
    if (!evmAddress || !solanaAddress || !amount) return;
    clearError();
    try {
      const hash = await submit({ evmAddress, solanaAddress, amount, withStake });
      setSubmitted({ txHash: hash, submittedAt: Date.now() });
    } catch {
      // error set in hook
    }
  };

  const handleReset = () => {
    setSubmitted(null);
    setAmount('');
    clearError();
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const quoteAge = lastFetch > 0 ? secondsAgo(lastFetch) : null;
  const quoteExpiring = quoteAge !== null && quoteAge > 20;

  // Button label
  const btnLabel = () => {
    if (!evmConnected) return 'Connect EVM Wallet';
    if (!solanaAddress) return 'Connect Solana Wallet';
    if (!hasValidAmount) return 'Enter Amount';
    if (noSolvers) return 'No Active Solvers';
    if (isBuilding) return 'Building transaction...';
    if (isSigning) return 'Confirm in wallet...';
    return 'Swap via Intent →';
  };

  return (
    <div className="flex items-center justify-center min-h-[80vh] px-4 relative">
      {/* bg glows */}
      <div className="absolute top-[20%] left-[25%] w-96 h-96 bg-primary/5 rounded-full blur-[100px] pointer-events-none z-0" />
      <div className="absolute bottom-[20%] right-[25%] w-[500px] h-[500px] bg-indigo-600/5 rounded-full blur-[120px] pointer-events-none z-0" />

      <div className="w-full max-w-md relative z-10 space-y-3">
        {/* Header */}
        <div className="flex justify-between items-center px-1">
          <div>
            <h1 className="text-xl font-bold text-white">Cross-chain Swap</h1>
            <p className="text-xs text-slate-500 mt-0.5">ETH on Base Sepolia → SOL on Solana · via Intent Bridge</p>
          </div>
          <div className="flex items-center gap-2">
            {evmConnected && (
              <button
                type="button"
                onClick={() => disconnect()}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                {evmAddress?.slice(0, 6)}…{evmAddress?.slice(-4)}
              </button>
            )}
            {quoteAge !== null && (
              <button
                onClick={refresh}
                title="Refresh quote"
                className={`p-1.5 rounded-full transition-all ${quoteExpiring ? 'text-amber-400 hover:text-amber-300 animate-pulse' : 'text-slate-500 hover:text-slate-300'}`}
              >
                <span className="material-symbols-outlined text-[18px]">refresh</span>
              </button>
            )}
          </div>
        </div>

        {/* Main card */}
        <div className="glass-panel rounded-2xl p-2 relative before:absolute before:inset-[-1px] before:-z-10 before:rounded-2xl before:bg-gradient-to-br before:from-primary/20 before:to-transparent before:pointer-events-none">

          {/* You send */}
          <div className="bg-surface-light/50 rounded-xl p-4 border border-white/5 focus-within:border-primary/30 transition-all">
            {/* Row 1: label + address */}
            <div className="flex justify-between items-center mb-3">
              <label className="text-xs font-medium text-slate-400">You send</label>
              {evmAddress && (
                <span className="text-xs text-slate-500 font-mono">
                  {evmAddress.slice(0, 6)}…{evmAddress.slice(-5)}
                </span>
              )}
            </div>
            {/* Row 2: amount input + token pill */}
            <div className="flex items-center gap-3">
              <input
                ref={inputRef}
                className="bg-transparent border-none p-0 text-3xl font-medium text-white placeholder-slate-600 focus:ring-0 w-full outline-none"
                placeholder="0"
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9.]/g, '');
                  if ((v.match(/\./g) ?? []).length <= 1) setAmount(v);
                }}
                autoFocus
              />
              {/* Token pill — Relay style: icon | TOKEN\nchain */}
              <div className="flex items-center gap-2.5 bg-surface border border-white/10 rounded-xl py-2 pl-2.5 pr-3 shrink-0">
                <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-indigo-300">Ξ</span>
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="font-bold text-white text-sm">ETH</span>
                  <span className="text-[10px] text-slate-500">Base Sepolia</span>
                </div>
              </div>
            </div>
            {/* Row 3: USD value + balance */}
            <div className="flex justify-between items-center mt-2">
              <span className="text-xs text-slate-600">
                {quote?.fromUsd && hasValidAmount
                  ? fmtUsd(quote.fromUsd * parseFloat(amount))
                  : '\u00a0'}
              </span>
              {ethBalanceFmt !== null ? (
                <span className="text-xs text-slate-500 flex items-center gap-1.5">
                  Balance: {ethBalanceFmt}
                  <button
                    type="button"
                    onClick={() => setAmount(ethBalanceRaw)}
                    className="text-[10px] font-bold text-primary hover:text-primary/70 uppercase transition-colors"
                  >
                    Max
                  </button>
                </span>
              ) : (
                <span className="text-xs text-slate-600">Balance: —</span>
              )}
            </div>
          </div>

          {/* Divider arrow */}
          <div className="relative h-2 flex items-center justify-center z-10 my-1">
            <div className="absolute bg-surface-light border-4 border-[#0e1716] rounded-xl p-2 text-slate-500">
              <span className="material-symbols-outlined text-[18px] block">south</span>
            </div>
          </div>

          {/* You receive */}
          <div className="bg-surface-light/50 rounded-xl p-4 border border-white/5 transition-all">
            {/* Row 1: label + solana address */}
            <div className="flex justify-between items-center mb-3">
              <label className="text-xs font-medium text-slate-400">You receive</label>
              {solanaAddress ? (
                <span className="text-xs text-slate-500 font-mono">
                  {solanaAddress.slice(0, 6)}…{solanaAddress.slice(-5)}
                </span>
              ) : (
                <span className="text-xs text-amber-500/80">wallet not connected</span>
              )}
            </div>
            {/* Row 2: estimated amount + token pill */}
            <div className="flex items-center gap-3">
              <div className="text-3xl font-medium w-full">
                {isQuoteLoading ? (
                  <span className="text-slate-600 text-2xl animate-pulse">…</span>
                ) : quote && hasValidAmount ? (
                  <span className="text-white">{parseFloat(quote.estimatedReceive).toFixed(4)}</span>
                ) : (
                  <span className="text-slate-600">0</span>
                )}
              </div>
              {/* Token pill */}
              <div className="flex items-center gap-2.5 bg-surface border border-white/10 rounded-xl py-2 pl-2.5 pr-3 shrink-0">
                <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-purple-300">{withStake ? 'm' : '◎'}</span>
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="font-bold text-white text-sm">{withStake ? 'mSOL' : 'SOL'}</span>
                  <span className="text-[10px] text-slate-500">Solana Devnet</span>
                </div>
              </div>
            </div>
            {/* Row 3: USD value + balance */}
            <div className="flex justify-between items-center mt-2">
              <span className="text-xs text-slate-600">
                {quote?.toUsd && hasValidAmount && quote.estimatedReceive
                  ? `≈ ${fmtUsd(quote.toUsd * parseFloat(quote.estimatedReceive))}`
                  : '\u00a0'}
              </span>
              {solBalance !== null ? (
                <span className="text-xs text-slate-500">
                  Balance: {solBalance} {withStake ? 'mSOL' : 'SOL'}
                </span>
              ) : (
                <span className="text-xs text-slate-600">Balance: —</span>
              )}
            </div>
          </div>

          {/* Quote info */}
          {hasValidAmount && (quote || isQuoteLoading || quoteError) && (
            <div className="mt-2 px-1 space-y-1.5">
              {quoteError && (
                <div className="flex items-center gap-2 text-red-400 text-xs py-1">
                  <span className="material-symbols-outlined text-sm">error</span>
                  {quoteError}
                </div>
              )}
              {quote && !quoteError && (
                <>
                  {/* Rate row */}
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Rate</span>
                    <span className="text-slate-300 font-medium">
                      1 ETH ≈ {fmtRate(quote.rate)} {withStake ? 'mSOL' : 'SOL'}
                    </span>
                  </div>
                  {/* Solvers + source row */}
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Active solvers</span>
                    <span className={`font-medium ${activeSolvers > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {activeSolvers} {activeSolvers > 0 ? '· competing' : '· none active'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Price source</span>
                    <span className="text-slate-400">
                      {quote.priceSource === 'pyth' ? '⚡ Pyth Network' : quote.priceSource === 'coingecko' ? '🦎 CoinGecko' : 'estimate'}
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
          )}

          {/* No solvers warning */}
          {noSolvers && (
            <div className="mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-start gap-2">
              <span className="material-symbols-outlined text-sm shrink-0 mt-0.5">warning</span>
              <span>No solver is currently active. Your ETH would be locked with no one to fill the order. Start a solver or try again later.</span>
            </div>
          )}

          {/* Marinade stake toggle */}
          {hasValidAmount && (
            <label className="mt-3 flex items-center gap-3 px-1 cursor-pointer group">
              <div
                onClick={() => setWithStake((v) => !v)}
                className={`relative w-9 h-5 rounded-full transition-colors duration-200 shrink-0 ${withStake ? 'bg-primary' : 'bg-white/10'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${withStake ? 'translate-x-4' : ''}`} />
              </div>
              <span className="text-xs text-slate-400 group-hover:text-slate-300 transition-colors select-none">
                Auto-stake via Marinade → receive <span className="font-semibold text-purple-300">mSOL</span>
              </span>
            </label>
          )}

          {/* Wallet status */}
          <div className="mt-3 space-y-1.5 px-1">
            {/* EVM wallet */}
            {evmConnected ? (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                <span>EVM: {evmAddress?.slice(0, 8)}…{evmAddress?.slice(-6)}</span>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-amber-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  <span>EVM wallet not connected</span>
                </div>
                <button
                  type="button"
                  onClick={() => connect({ connector: connectors[0] })}
                  disabled={isConnecting}
                  className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
                >
                  {isConnecting ? 'Connecting...' : 'Connect'}
                </button>
              </div>
            )}

            {/* Solana wallet */}
            {solanaAddress ? (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                <span>Solana: {solanaAddress.slice(0, 8)}…{solanaAddress.slice(-6)}</span>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-amber-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  <span>Solana wallet not connected</span>
                </div>
                <div className="wallet-adapter-button-override">
                  <WalletMultiButton />
                </div>
              </div>
            )}
          </div>

          {/* Build error */}
          {buildError && (
            <div className="mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-start gap-2">
              <span className="material-symbols-outlined text-sm shrink-0 mt-0.5">error</span>
              <span>{buildError}</span>
            </div>
          )}

          {/* Swap button */}
          <button
            onClick={!evmConnected ? () => connect({ connector: connectors[0] }) : handleSwap}
            disabled={(evmConnected && !canSwap) || isBusy}
            className={`w-full mt-4 font-extrabold text-base py-4 rounded-xl transition-all flex items-center justify-center gap-2
              ${noSolvers
                ? 'bg-red-500/20 border border-red-500/30 text-red-400 cursor-not-allowed'
                : canSwap || !evmConnected
                  ? 'bg-gradient-to-r from-teal-400 to-cyan-400 hover:from-teal-300 hover:to-cyan-300 text-black shadow-[0_0_20px_rgba(13,242,223,0.25)]'
                  : 'bg-white/5 text-slate-500 cursor-not-allowed'
              }`}
          >
            {isBusy && (
              <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
            )}
            {btnLabel()}
          </button>
        </div>

        {/* SolverAuctionCard — shown after submit */}
        {submitted && evmAddress && (
          <div className="animate-fade-in-up">
            <SolverAuctionCard
              userAddress={evmAddress}
              submittedAt={submitted.submittedAt}
            />
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
              <button
                onClick={handleReset}
                className="text-xs text-primary hover:text-primary/80 font-semibold transition-colors"
              >
                New swap
              </button>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-slate-600 pb-2">
          Intent Bridge · Dutch auction · Wormhole · Base Sepolia ↔ Solana Devnet
        </p>
      </div>

      {/* WalletMultiButton style override — hide default ugly styling */}
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
};

export default SwapPage;
