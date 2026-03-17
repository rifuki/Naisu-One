import React, { useState, useMemo, useEffect } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { useSwapBuild } from '@/hooks/useSwapBuild';
import { useSwapQuote } from '@/hooks/useSwapQuote';
import { useTokenBalance } from '@/hooks/useTokenBalance';

// Base Sepolia tokens for Uniswap V4 (build on backend, sign in wallet)
// USDC = 6 decimals, WETH = 18 decimals (amounts from quote API are in raw units)
const BASE_SEPOLIA_TOKENS = [
  { symbol: 'USDC', name: 'USD Coin', address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', decimals: 6, icon: 'currency_bitcoin', color: 'bg-blue-500/20 text-blue-400' },
  { symbol: 'WETH', name: 'Wrapped Ether', address: '0x4200000000000000000000000000000000000006', decimals: 18, icon: 'token', color: 'bg-slate-200 text-black' },
];

/** Normalize raw amount to integer string (API may return number or string with decimals) */
function normalizeRawAmount(raw: string | number): string {
  const s = String(raw).trim();
  const idx = s.indexOf('.');
  return idx === -1 ? s : s.slice(0, idx);
}

/** Format raw quote amount for display (no scientific notation; trim trailing zeros) */
function formatQuoteDisplay(raw: string | number, decimals: number): string {
  const intStr = normalizeRawAmount(raw);
  if (!intStr) return '0';
  try {
    const s = formatUnits(BigInt(intStr), decimals);
    const num = parseFloat(s);
    if (num === 0) return '0';
    const maxDecimals = Math.min(12, decimals);
    return num.toFixed(maxDecimals).replace(/\.?0+$/, '');
  } catch {
    return '0';
  }
}

const SwapPage: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { buildAndSign, isBusy, isBuilding, isSigning, error, clearError, txHashes } = useSwapBuild();

  const [payToken, setPayToken] = useState(BASE_SEPOLIA_TOKENS[0]);
  const [receiveToken, setReceiveToken] = useState(BASE_SEPOLIA_TOKENS[1]);
  const [payAmount, setPayAmount] = useState('');
  const [swapStatus, setSwapStatus] = useState<'idle' | 'building' | 'signing' | 'success'>('idle');

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [tokenModalSide, setTokenModalSide] = useState<'pay' | 'receive' | null>(null);

  // Raw amount for quote API (only when valid number > 0)
  const amountInRaw = useMemo(() => {
    const p = parseFloat(payAmount);
    if (isNaN(p) || p <= 0) return '';
    try {
      return parseUnits(payAmount, payToken.decimals).toString();
    } catch {
      return '';
    }
  }, [payAmount, payToken.decimals]);

  const hasValidAmount = Boolean(payAmount && parseFloat(payAmount) > 0);
  const { quote, isLoading: isLoadingQuote, error: quoteError } = useSwapQuote(
    payToken.address,
    receiveToken.address,
    amountInRaw,
    hasValidAmount
  );

  // Display receive amount from quote (expectedOutput is raw units; use receive token decimals)
  const receiveAmountDisplay = useMemo(() => {
    if (!hasValidAmount) return '';
    if (isLoadingQuote) return '...';
    if (quote) return formatQuoteDisplay(quote.expectedOutput, receiveToken.decimals);
    if (quoteError) return '—';
    return '...';
  }, [hasValidAmount, isLoadingQuote, quote, receiveToken.decimals, quoteError]);

  useEffect(() => {
    if (quote) setIsDetailsOpen(true);
  }, [quote]);

  const handleSwapTokens = () => {
    setPayToken(receiveToken);
    setReceiveToken(payToken);
    setPayAmount(receiveAmountDisplay && receiveAmountDisplay !== '...' && receiveAmountDisplay !== '—' ? receiveAmountDisplay : '');
  };

  const handleSwapAction = async () => {
    if (!address || !payAmount || parseFloat(payAmount) <= 0) return;
    if (!isConnected) {
      connect({ connector: connectors[0] });
      return;
    }
    
    setSwapStatus('building');
    clearError();
    
    try {
      const amountInRaw = parseUnits(payAmount, payToken.decimals).toString();
      console.log('[Swap] Starting swap:', {
        sender: address,
        tokenIn: payToken.address,
        tokenOut: receiveToken.address,
        amountIn: amountInRaw,
      });
      
      const hashes = await buildAndSign({
        sender: address,
        tokenIn: payToken.address,
        tokenOut: receiveToken.address,
        amountIn: amountInRaw,
        minAmountOut: '0',
        deadlineSeconds: 3600,
      });
      
      console.log('[Swap] Success! Tx hashes:', hashes);
      setSwapStatus('success');
      setPayAmount('');
      setTimeout(() => setSwapStatus('idle'), 4000);
    } catch (err) {
      console.error('[Swap] Failed:', err);
      setSwapStatus('idle');
    }
  };

  const statusMessage = isBuilding 
    ? 'Building transaction...' 
    : isSigning 
      ? 'Confirm in wallet...' 
      : swapStatus === 'success' 
        ? 'Swap successful!' 
        : null;
  const canSwap = isConnected && address && payAmount && parseFloat(payAmount) > 0 && !isBusy;

  const { balance: payBalance, formatted: payBalanceFormatted, isLoading: payBalanceLoading } = useTokenBalance(
    payToken.address as `0x${string}`,
    address ?? undefined,
    payToken.decimals
  );
  const { balance: receiveBalance, formatted: receiveBalanceFormatted, isLoading: receiveBalanceLoading } = useTokenBalance(
    receiveToken.address as `0x${string}`,
    address ?? undefined,
    receiveToken.decimals
  );

  const setMaxPayAmount = () => {
    if (payBalanceFormatted !== undefined) setPayAmount(payBalanceFormatted);
  };

  return (
    <div className="flex items-center justify-center min-h-[80vh] px-4 relative">
      <div className="absolute top-[20%] left-[25%] w-96 h-96 bg-primary/5 rounded-full blur-[100px] pointer-events-none z-0"></div>
      <div className="absolute bottom-[20%] right-[25%] w-[500px] h-[500px] bg-indigo-600/5 rounded-full blur-[120px] pointer-events-none z-0"></div>

      <div className="w-full max-w-md relative z-10">
        <div className="flex justify-between items-center mb-4 px-1">
          <h1 className="text-xl font-bold text-white">Swap</h1>
          <div className="flex items-center gap-2 relative">
            {isConnected ? (
              <>
                <span className="text-xs text-slate-400 truncate max-w-[120px]">{address?.slice(0, 6)}…{address?.slice(-4)}</span>
                <button type="button" onClick={() => disconnect()} className="text-slate-400 hover:text-white text-xs font-medium">Disconnect</button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => connect({ connector: connectors[0] })}
                disabled={isConnecting}
                className="px-3 py-1.5 rounded-lg bg-primary text-black text-sm font-bold hover:opacity-90 disabled:opacity-50"
              >
                {isConnecting ? 'Connecting...' : 'Connect Wallet'}
              </button>
            )}
            <button onClick={() => setPayAmount('')} className="text-slate-400 hover:text-white transition-colors p-1.5 rounded-full hover:bg-white/5">
              <span className="material-symbols-outlined text-[20px]">refresh</span>
            </button>
            <button onClick={() => setIsSettingsOpen(!isSettingsOpen)} className="text-slate-400 hover:text-white transition-colors p-1.5 rounded-full hover:bg-white/5">
              <span className="material-symbols-outlined text-[20px]">settings</span>
            </button>
            {isSettingsOpen && (
              <div className="absolute top-full right-0 mt-2 w-56 bg-[#1a1f1e] border border-white/10 rounded-xl shadow-2xl p-4 z-50">
                <h4 className="text-sm font-bold text-white mb-3">Slippage</h4>
                <div className="flex gap-2">
                  <button className="flex-1 bg-primary text-black text-xs font-bold py-1.5 rounded-lg">Auto</button>
                  <button className="flex-1 bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold py-1.5 rounded-lg">0.5%</button>
                  <button className="flex-1 bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold py-1.5 rounded-lg">1%</button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="glass-panel rounded-2xl p-2 relative before:absolute before:inset-[-1px] before:-z-10 before:rounded-2xl before:bg-gradient-to-br before:from-primary/20 before:to-transparent before:pointer-events-none">
          {/* Pay */}
          <div className="bg-surface-light/50 rounded-xl p-4 border border-white/5 focus-within:border-primary/30 transition-all mb-1">
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-medium text-slate-400">You pay</label>
              {address && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-500">
                    Balance: {payBalanceLoading ? '...' : payBalanceFormatted !== undefined ? `${Number(payBalanceFormatted).toLocaleString('en-US', { maximumFractionDigits: 6 })} ${payToken.symbol}` : '—'}
                  </span>
                  {payBalanceFormatted !== undefined && parseFloat(payBalanceFormatted) > 0 && (
                    <button type="button" onClick={setMaxPayAmount} className="text-[10px] font-bold text-primary hover:text-primary/80 uppercase">Max</button>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-4">
              <input
                className="bg-transparent border-none p-0 text-3xl font-medium text-white placeholder-slate-600 focus:ring-0 w-full outline-none"
                placeholder="0"
                type="text"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
              />
              <button onClick={() => setTokenModalSide('pay')} className="flex items-center gap-2 bg-surface border border-white/10 hover:border-primary/40 rounded-full py-1.5 pl-2 pr-3 transition-all group shrink-0">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center overflow-hidden ${payToken.color}`}>
                  <span className="material-symbols-outlined text-sm">{payToken.icon}</span>
                </div>
                <span className="font-bold text-lg text-white">{payToken.symbol}</span>
                <span className="material-symbols-outlined text-slate-400 group-hover:text-white">expand_more</span>
              </button>
            </div>
          </div>

          <div className="relative h-2 flex items-center justify-center z-10">
            <button onClick={handleSwapTokens} className="absolute bg-surface-light border-4 border-[#0e1716] rounded-xl p-2 text-primary hover:text-white hover:bg-surface rounded-full transition-all duration-300 shadow-lg">
              <span className="material-symbols-outlined text-[20px] block">arrow_downward</span>
            </button>
          </div>

          {/* Receive */}
          <div className="bg-surface-light/50 rounded-xl p-4 border border-white/5 focus-within:border-primary/30 transition-all mt-1">
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-medium text-slate-400">You receive</label>
              {address && (
                <span className="text-xs text-slate-500">
                  Balance: {receiveBalanceLoading ? '...' : receiveBalanceFormatted !== undefined ? `${Number(receiveBalanceFormatted).toLocaleString('en-US', { maximumFractionDigits: 6 })} ${receiveToken.symbol}` : '—'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-4">
              <input className="bg-transparent border-none p-0 text-3xl font-medium text-white placeholder-slate-600 w-full outline-none" placeholder="0" readOnly type="text" value={receiveAmountDisplay} />
              <button onClick={() => setTokenModalSide('receive')} className="flex items-center gap-2 bg-surface border border-white/10 hover:border-primary/40 rounded-full py-1.5 pl-2 pr-3 transition-all group shrink-0">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center overflow-hidden ${receiveToken.color}`}>
                  <span className="material-symbols-outlined text-sm">{receiveToken.icon}</span>
                </div>
                <span className="font-bold text-lg text-white">{receiveToken.symbol}</span>
                <span className="material-symbols-outlined text-slate-400 group-hover:text-white">expand_more</span>
              </button>
            </div>
          </div>

          {/* Quote details */}
          {hasValidAmount && (quote || isLoadingQuote || quoteError) && (
            <div className="mt-3 rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden">
              <button
                type="button"
                onClick={() => setIsDetailsOpen(!isDetailsOpen)}
                className="w-full flex justify-between items-center px-3 py-3 text-xs text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors"
              >
                <span className="font-medium">Transaction details</span>
                <span className={`material-symbols-outlined text-[16px] transition-transform duration-300 ${isDetailsOpen ? 'rotate-180' : ''}`}>expand_more</span>
              </button>
              <div className={`grid transition-all duration-300 ${isDetailsOpen ? 'grid-rows-[1fr] opacity-100 border-t border-white/5' : 'grid-rows-[0fr] opacity-0'}`}>
                <div className="overflow-hidden">
                  <div className="p-3 space-y-2.5 text-xs bg-black/20">
                    {isLoadingQuote && (
                      <div className="flex items-center gap-2 text-slate-400">
                        <span className="material-symbols-outlined animate-spin text-base">progress_activity</span>
                        Getting quote...
                      </div>
                    )}
                    {quoteError && (
                      <div className="flex items-center gap-2 text-red-400">
                        <span className="material-symbols-outlined text-base">error</span>
                        {quoteError}
                      </div>
                    )}
                    {quote && !quoteError && (
                      <>
                        <div className="flex justify-between text-slate-400">
                          <span>Amount in</span>
                          <span className="text-slate-300">{formatQuoteDisplay(quote.amountIn, payToken.decimals)} {payToken.symbol}</span>
                        </div>
                        <div className="flex justify-between text-slate-400">
                          <span>Amount in (after fee)</span>
                          <span className="text-slate-300">{formatQuoteDisplay(quote.amountInAfterFee, payToken.decimals)} {payToken.symbol}</span>
                        </div>
                        <div className="flex justify-between text-slate-400">
                          <span>Expected output</span>
                          <span className="text-white font-medium">{receiveAmountDisplay} {receiveToken.symbol}</span>
                        </div>
                        <div className="flex justify-between text-slate-400">
                          <span>Price impact</span>
                          <span className="text-emerald-400 font-medium">{quote.priceImpact}%</span>
                        </div>
                        <div className="flex justify-between text-slate-400">
                          <span>Fee</span>
                          <span className="text-slate-300">{(quote.fee / 10000).toFixed(2)}%</span>
                        </div>
                        <div className="flex justify-between text-slate-400">
                          <span>Quote</span>
                          <span className="text-slate-500 text-[10px]">Naisu aggregator</span>
                        </div>
                        <div className="flex justify-between text-slate-400 pt-2 border-t border-white/5">
                          <span>Rate</span>
                          <span className="text-slate-300">1 {payToken.symbol} ≈ {quote && parseFloat(payAmount) > 0 && receiveAmountDisplay && !['...', '—'].includes(receiveAmountDisplay) ? (() => {
                            const pay = parseFloat(payAmount);
                            const recv = parseFloat(receiveAmountDisplay);
                            if (pay <= 0 || !Number.isFinite(recv)) return '—';
                            const r = recv / pay;
                            if (r <= 0 || !Number.isFinite(r)) return '—';
                            if (r >= 1e10) return '—';
                            return r < 0.0001 ? r.toFixed(10).replace(/\.?0+$/, '') : r.toLocaleString(undefined, { maximumFractionDigits: 6, minimumFractionDigits: 0 });
                          })() : '—'} {receiveToken.symbol}</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
              <span className="material-symbols-outlined">error</span>
              {error}
            </div>
          )}

          {txHashes.length > 0 && (
            <div className="mt-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
              <span className="material-symbols-outlined text-sm mr-1">check_circle</span>
              {txHashes.length} tx(s) confirmed.{' '}
              <a href={`https://sepolia.basescan.org/tx/${txHashes[0]}`} target="_blank" rel="noopener noreferrer" className="underline">View on BaseScan</a>
            </div>
          )}

          <button
            onClick={handleSwapAction}
            disabled={!canSwap && isConnected}
            className={`w-full mt-4 font-extrabold text-lg py-4 rounded-xl shadow-[0_0_20px_rgba(13,242,223,0.3)] transition-all flex items-center justify-center gap-2
              ${swapStatus === 'success' ? 'bg-emerald-500 text-white' : 'bg-gradient-to-r from-teal-400 to-cyan-400 hover:from-teal-300 hover:to-cyan-300 text-black'}
              ${!canSwap && isConnected ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {!isConnected && 'Connect Wallet'}
            {isConnected && !payAmount && !isBusy && 'Enter Amount'}
            {isConnected && isBusy && statusMessage && (
              <>
                <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin"></div>
                {statusMessage}
              </>
            )}
            {isConnected && payAmount && !isBusy && swapStatus !== 'success' && 'Swap'}
            {isConnected && swapStatus === 'success' && !isBusy && (
              <>
                <span className="material-symbols-outlined">check</span>
                Success
              </>
            )}
          </button>
        </div>

        <p className="mt-6 text-center text-xs text-slate-600">
          Build on backend · You sign in wallet. Base Sepolia.
        </p>

        {/* Token modal */}
        {tokenModalSide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setTokenModalSide(null)}></div>
            <div className="relative bg-[#1a1f1e] border border-white/10 rounded-2xl w-full max-w-sm p-4 shadow-2xl flex flex-col max-h-[80vh]">
              <div className="flex justify-between items-center mb-4 pb-2 border-b border-white/5">
                <h3 className="text-lg font-bold text-white">Select Token</h3>
                <button onClick={() => setTokenModalSide(null)} className="text-slate-400 hover:text-white"><span className="material-symbols-outlined">close</span></button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-1">
                {BASE_SEPOLIA_TOKENS.map((token) => (
                  <button
                    key={token.symbol}
                    onClick={() => {
                      if (tokenModalSide === 'pay') {
                        if (token.symbol === receiveToken.symbol) setReceiveToken(payToken);
                        setPayToken(token);
                      } else {
                        if (token.symbol === payToken.symbol) setPayToken(receiveToken);
                        setReceiveToken(token);
                      }
                      setTokenModalSide(null);
                    }}
                    className="w-full flex items-center justify-between p-3 hover:bg-white/5 rounded-xl transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${token.color}`}>
                        <span className="material-symbols-outlined text-sm">{token.icon}</span>
                      </div>
                      <div className="text-left">
                        <div className="text-white font-bold">{token.symbol}</div>
                        <div className="text-slate-500 text-xs">{token.name}</div>
                      </div>
                    </div>
                    {(token.symbol === payToken.symbol && tokenModalSide === 'pay') || (token.symbol === receiveToken.symbol && tokenModalSide === 'receive') ? (
                      <span className="material-symbols-outlined text-primary">check</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SwapPage;
