import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAccount, useConnect, useDisconnect, useBalance } from 'wagmi';
import { useConnection } from '@solana/wallet-adapter-react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PublicKey, Transaction } from '@solana/web3.js';
import { useSolanaAddress } from '@/hooks/useSolanaAddress';
import { useIntentQuote } from '@/hooks/useIntentQuote';
import { useCreateOrder } from '@/hooks/useCreateOrder';
import { useYieldRates, type ProtocolRate } from '@/hooks/useYieldRates';
import { usePortfolio, buildUnstakeMsolTx } from '@/hooks/usePortfolio';
import SolverAuctionCard from '@/components/SolverAuctionCard';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function rawToUi(raw: string, decimals: number): string {
  if (!raw || raw === '0') return '0';
  const n = Number(BigInt(raw)) / 10 ** decimals;
  return n < 0.0001 ? n.toExponential(4) : n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

// ── Protocol icons / cards (Stake tab) ───────────────────────────────────────

type ProtocolId = 'marinade' | 'marginfi';

function ProtocolIcon({ id }: { id: ProtocolId }) {
  if (id === 'marinade') return (
    <div className="w-10 h-10 rounded-full bg-blue-400/20 flex items-center justify-center shrink-0">
      <span className="text-base font-bold text-blue-400">m</span>
    </div>
  );
  if (id === 'marginfi') return (
    <div className="w-10 h-10 rounded-full bg-orange-400/20 flex items-center justify-center shrink-0">
      <span className="text-base font-bold text-orange-400">f</span>
    </div>
  );
  return (
    <div className="w-10 h-10 rounded-full bg-purple-400/20 flex items-center justify-center shrink-0">
      <span className="text-base font-bold text-purple-400">◎</span>
    </div>
  );
}

function riskBadgeClass(riskLevel: string): string {
  switch (riskLevel) {
    case 'low':    return 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20';
    case 'medium': return 'bg-amber-500/15 text-amber-400 border border-amber-500/20';
    case 'high':   return 'bg-red-500/15 text-red-400 border border-red-500/20';
    default:       return 'bg-slate-500/15 text-slate-400 border border-slate-500/20';
  }
}

function ProtocolCard({ rate, selected, onSelect }: { rate: ProtocolRate; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left flex items-center gap-4 p-4 rounded-xl border transition-all
        ${selected ? 'border-primary/40 bg-primary/5' : 'border-white/8 bg-white/2 hover:border-white/15'}`}
    >
      <ProtocolIcon id={rate.id} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-white text-sm">{rate.name}</span>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${riskBadgeClass(rate.riskLevel)}`}>
            {rate.riskLabel}
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-0.5 truncate">{rate.description}</p>
      </div>
      <div className="text-right shrink-0">
        <div className="text-2xl font-bold text-emerald-400">
          {rate.apy > 0 ? `${rate.apy.toFixed(2)}%` : '— %'}
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5">APY</div>
      </div>
    </button>
  );
}

function ProtocolCardSkeleton() {
  return (
    <div className="w-full flex items-center gap-4 p-4 rounded-xl border border-white/8 bg-white/2 animate-pulse">
      <div className="w-10 h-10 rounded-full bg-white/10 shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 bg-white/10 rounded w-32" />
        <div className="h-2.5 bg-white/5 rounded w-48" />
      </div>
      <div className="text-right space-y-1 shrink-0">
        <div className="h-6 bg-white/10 rounded w-16" />
        <div className="h-2 bg-white/5 rounded w-8 ml-auto" />
      </div>
    </div>
  );
}

// ── Unstake modal (Positions tab) ─────────────────────────────────────────────

interface UnstakeModalProps {
  maxRaw: string; decimals: number; symbol: string;
  onClose: () => void;
  onConfirm: (amountRaw: string) => Promise<void>;
}

function UnstakeModal({ maxRaw, decimals, symbol, onClose, onConfirm }: UnstakeModalProps) {
  const maxUi = rawToUi(maxRaw, decimals);
  const [input, setInput]     = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState('');

  const amountRaw = input ? String(BigInt(Math.floor(parseFloat(input) * 10 ** decimals))) : '0';
  const valid = input && parseFloat(input) > 0 && BigInt(amountRaw) <= BigInt(maxRaw);

  async function handleConfirm() {
    if (!valid) return;
    setLoading(true); setErr('');
    try { await onConfirm(amountRaw); onClose(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#0c1a18] border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl mx-4">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-white">Unstake {symbol}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="text-xs text-slate-500 mb-1.5 flex justify-between">
          <span>Amount</span>
          <button onClick={() => setInput(maxUi.replace(/,/g, ''))} className="text-primary hover:underline">
            Max: {maxUi}
          </button>
        </div>
        <div className="flex gap-2 items-center bg-white/5 border border-white/10 rounded-xl px-4 py-3 mb-4">
          <input
            type="number" value={input} onChange={e => setInput(e.target.value)}
            placeholder="0.00"
            className="bg-transparent flex-1 text-white text-sm outline-none placeholder:text-slate-600"
          />
          <span className="text-slate-400 text-sm font-medium">{symbol}</span>
        </div>

        {/* Breakdown */}
        <div className="text-xs bg-white/4 border border-white/8 rounded-xl px-3 py-2.5 mb-4 space-y-1">
          <div className="flex justify-between">
            <span className="text-slate-500">You send</span>
            <span className="text-white font-medium">{input || '0'} {symbol}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">You receive (est.)</span>
            <span className="text-green-400 font-medium">
              ~{input ? (parseFloat(input) * 0.997).toFixed(6) : '0'} SOL
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Fee</span>
            <span className="text-slate-400">~0.3% (Marinade liq. pool)</span>
          </div>
          <div className="border-t border-white/5 pt-1.5 mt-1 text-[10px] text-slate-600">
            ⚠ Phantom shows mSOL as "Unknown" on devnet — this is normal.
          </div>
        </div>

        {err && (
          <div className="text-xs text-red-400 bg-red-400/10 rounded-xl px-3 py-2 mb-3">{err}</div>
        )}

        <button
          onClick={handleConfirm} disabled={!valid || loading}
          className={`w-full py-3 rounded-xl font-bold text-sm transition-all
            ${valid && !loading
              ? 'bg-primary text-black hover:opacity-90 active:scale-95'
              : 'bg-white/5 text-slate-500 cursor-not-allowed'}`}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
              Sign in wallet…
            </span>
          ) : 'Confirm Unstake'}
        </button>
      </div>
    </div>
  );
}

// ── Positions tab content ─────────────────────────────────────────────────────

function PositionsTab({ solAddress }: { solAddress: string | null }) {
  const { connection }                 = useConnection();
  const { signTransaction, connected } = useWallet();
  const { data, isLoading, error, refresh } = usePortfolio(solAddress);

  const [showUnstakeModal, setShowUnstakeModal] = useState(false);
  const [txResult, setTxResult]                 = useState<{ sig: string } | null>(null);
  const [actionErr, setActionErr]               = useState<string | null>(null);

  async function handleUnstake(amountRaw: string) {
    if (!solAddress || !signTransaction) throw new Error('Wallet not connected');
    const base64 = await buildUnstakeMsolTx(solAddress, amountRaw);
    const binary  = atob(base64);
    const bytes   = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const tx     = Transaction.from(bytes);
    const signed = await signTransaction(tx);
    const sig    = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
    await connection.confirmTransaction(sig, 'confirmed');
    setTxResult({ sig });
    refresh();
  }

  if (!solAddress) {
    return (
      <div className="text-center py-10">
        <p className="text-sm text-slate-500 mb-4">Connect your Solana wallet to view positions.</p>
        <WalletMultiButton />
      </div>
    );
  }

  const msolUi  = data ? rawToUi(data.msol, data.msolDecimals) : '—';
  const solUi   = data ? rawToUi(data.sol, 9) : '—';
  const hasMsol = data && BigInt(data.msol) > 0n;

  return (
    <div className="space-y-3">
      {/* Refresh row */}
      <div className="flex justify-between items-center px-1">
        <span className="text-xs text-slate-500 font-mono">{solAddress.slice(0, 6)}…{solAddress.slice(-4)}</span>
        <button onClick={refresh} disabled={isLoading}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-white transition-colors">
          <span className={`material-symbols-outlined text-sm ${isLoading ? 'animate-spin' : ''}`}>refresh</span>
          {isLoading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-400/10 rounded-xl px-3 py-2">{error}</div>
      )}

      {txResult && (
        <div className="flex items-center justify-between bg-green-400/10 border border-green-400/20 rounded-xl px-3 py-2.5">
          <div>
            <div className="text-xs font-semibold text-green-400">Unstake confirmed ✓</div>
            <a href={`https://explorer.solana.com/tx/${txResult.sig}?cluster=devnet`}
               target="_blank" rel="noreferrer"
               className="text-[11px] text-slate-500 hover:text-primary font-mono underline">
              {txResult.sig.slice(0, 20)}…
            </a>
          </div>
          <button onClick={() => setTxResult(null)} className="text-slate-500 hover:text-white">
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      )}

      {actionErr && (
        <div className="text-xs text-red-400 bg-red-400/10 rounded-xl px-3 py-2">
          {actionErr}
          <button onClick={() => setActionErr(null)} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* mSOL card */}
      <div className={`flex items-center gap-4 p-4 rounded-xl border transition-all
        ${hasMsol ? 'border-blue-400/20 bg-blue-400/5' : 'border-white/8 bg-white/2 opacity-60'}`}>
        <div className="w-10 h-10 rounded-full bg-blue-400/20 flex items-center justify-center shrink-0">
          <span className="text-base font-bold text-blue-400">m</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white text-sm">mSOL</span>
            {hasMsol && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-blue-400 bg-blue-400/10">Earning</span>}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">Marinade Finance · Liquid Staking</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-bold text-white tabular-nums">{msolUi}</div>
          <div className="text-[10px] text-slate-500">mSOL</div>
        </div>
        {hasMsol && connected && (
          <button onClick={() => setShowUnstakeModal(true)}
            className="text-xs font-semibold px-3 py-1.5 rounded-xl border border-blue-400/30 bg-blue-400/10 text-blue-300 hover:bg-blue-400/20 transition-all shrink-0">
            Unstake
          </button>
        )}
      </div>

      {/* SOL card */}
      <div className="flex items-center gap-4 p-4 rounded-xl border border-white/8 bg-white/2">
        <div className="w-10 h-10 rounded-full bg-purple-400/20 flex items-center justify-center shrink-0">
          <svg width="16" height="16" viewBox="0 0 128 128" fill="none">
            <path d="M21.1 94.5c.8-.8 1.9-1.3 3.1-1.3h89.5c2 0 3 2.4 1.6 3.8L98 114.3c-.8.8-1.9 1.3-3.1 1.3H5.4c-2 0-3-2.4-1.6-3.8L21.1 94.5z" fill="url(#es1)"/>
            <path d="M21.1 13.7C21.9 12.9 23 12.4 24.2 12.4h89.5c2 0 3 2.4 1.6 3.8L98 33.5c-.8.8-1.9 1.3-3.1 1.3H5.4c-2 0-3-2.4-1.6-3.8L21.1 13.7z" fill="url(#es2)"/>
            <path d="M98 53.9c-.8-.8-1.9-1.3-3.1-1.3H5.4c-2 0-3 2.4-1.6 3.8l17.3 17.3c.8.8 1.9 1.3 3.1 1.3h89.5c2 0 3-2.4 1.6-3.8L98 53.9z" fill="url(#es3)"/>
            <defs>
              <linearGradient id="es1" x1="0" y1="128" x2="128" y2="0" gradientUnits="userSpaceOnUse"><stop stopColor="#9945FF"/><stop offset="1" stopColor="#14F195"/></linearGradient>
              <linearGradient id="es2" x1="0" y1="128" x2="128" y2="0" gradientUnits="userSpaceOnUse"><stop stopColor="#9945FF"/><stop offset="1" stopColor="#14F195"/></linearGradient>
              <linearGradient id="es3" x1="0" y1="128" x2="128" y2="0" gradientUnits="userSpaceOnUse"><stop stopColor="#9945FF"/><stop offset="1" stopColor="#14F195"/></linearGradient>
            </defs>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-white text-sm">SOL</span>
          <div className="text-xs text-slate-500 mt-0.5">Solana Devnet · Native</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-bold text-white tabular-nums">{solUi}</div>
          <div className="text-[10px] text-slate-500">SOL</div>
        </div>
      </div>

      {showUnstakeModal && data && (
        <UnstakeModal
          maxRaw={data.msol} decimals={data.msolDecimals} symbol="mSOL"
          onClose={() => setShowUnstakeModal(false)}
          onConfirm={async (amountRaw) => {
            setActionErr(null);
            try { await handleUnstake(amountRaw); }
            catch (e) { const msg = e instanceof Error ? e.message : String(e); setActionErr(msg); throw e; }
          }}
        />
      )}
    </div>
  );
}

// ── Main EarnPage ─────────────────────────────────────────────────────────────

type Tab = 'stake' | 'positions';

const EarnPage: React.FC = () => {
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const solanaAddress = useSolanaAddress();

  const [activeTab, setActiveTab] = useState<Tab>('stake');
  const [amount, setAmount] = useState('');
  const [selectedProtocol, setSelectedProtocol] = useState<ProtocolId>('marinade');
  const [submitted, setSubmitted] = useState<{ txHash: string; submittedAt: number } | null>(null);

  const { data: ethBalanceData } = useBalance({ address: evmAddress, chainId: 84532 });
  const ethBalanceFmt = ethBalanceData
    ? (Number(ethBalanceData.value) / 10 ** ethBalanceData.decimals).toFixed(4) : null;
  const ethBalanceRaw = ethBalanceData
    ? (Number(ethBalanceData.value) / 10 ** ethBalanceData.decimals).toString() : '';

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

  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const { quote, isLoading: isQuoteLoading, error: quoteError, lastFetch, refresh } = useIntentQuote(amount);
  const { rates, isLoading: isRatesLoading } = useYieldRates();
  const { submit, isBuilding, isSigning, isBusy, error: buildError, clearError } = useCreateOrder();

  const hasValidAmount = Boolean(amount && parseFloat(amount) > 0);
  const activeSolvers = quote?.activeSolvers ?? 0;
  const noSolvers = hasValidAmount && quote && activeSolvers === 0;

  const outputToken: 'msol' | 'marginfi' =
    selectedProtocol === 'marinade' ? 'msol' : 'marginfi';

  const canEarn = evmConnected && !!solanaAddress && hasValidAmount && !isBusy && !noSolvers;
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRate = rates.find((r) => r.id === selectedProtocol) ?? null;
  const receiveLabel = selectedRate?.receiveLabel ?? selectedProtocol.toUpperCase();

  const handleEarn = async () => {
    if (!evmAddress || !solanaAddress || !amount) return;
    clearError();
    try {
      const hash = await submit({ evmAddress, solanaAddress, amount, outputToken });
      setSubmitted({ txHash: hash, submittedAt: Date.now() });
    } catch { /* error set in hook */ }
  };

  const handleReset = () => {
    setSubmitted(null); setAmount(''); clearError();
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const quoteAge = lastFetch > 0 ? secondsAgo(lastFetch) : null;
  const quoteExpiring = quoteAge !== null && quoteAge > 20;

  const btnLabel = () => {
    if (!evmConnected)    return 'Connect EVM Wallet';
    if (!solanaAddress)   return 'Connect Solana Wallet';
    if (!hasValidAmount)  return 'Enter Amount';
    if (noSolvers)        return 'No Active Solvers';
    if (isBuilding)       return 'Building transaction...';
    if (isSigning)        return 'Confirm in wallet...';
    return 'Earn via Intent →';
  };

  return (
    <div className="flex items-center justify-center min-h-[80vh] px-4 relative">
      <div className="absolute top-[20%] left-[25%] w-96 h-96 bg-emerald-500/5 rounded-full blur-[100px] pointer-events-none z-0" />
      <div className="absolute bottom-[20%] right-[25%] w-[500px] h-[500px] bg-primary/5 rounded-full blur-[120px] pointer-events-none z-0" />

      <div className="w-full max-w-md relative z-10 space-y-3">
        {/* Header */}
        <div className="flex justify-between items-center px-1">
          <div>
            <h1 className="text-xl font-bold text-white">Earn</h1>
            <p className="text-xs text-slate-500 mt-0.5">Bridge ETH → yield-bearing position on Solana Devnet</p>
          </div>
          <div className="flex items-center gap-2">
            {evmConnected && activeTab === 'stake' && (
              <button type="button" onClick={() => disconnect()}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
                {evmAddress?.slice(0, 6)}…{evmAddress?.slice(-4)}
              </button>
            )}
            {quoteAge !== null && activeTab === 'stake' && (
              <button onClick={refresh} title="Refresh quote"
                className={`p-1.5 rounded-full transition-all ${quoteExpiring ? 'text-amber-400 hover:text-amber-300 animate-pulse' : 'text-slate-500 hover:text-slate-300'}`}>
                <span className="material-symbols-outlined text-[18px]">refresh</span>
              </button>
            )}
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 p-1 bg-white/5 rounded-xl border border-white/8">
          {(['stake', 'positions'] as Tab[]).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all capitalize
                ${activeTab === tab
                  ? 'bg-[#0c1a18] text-white shadow border border-white/10'
                  : 'text-slate-500 hover:text-white'}`}>
              {tab === 'stake' ? '⬆ Stake' : '📊 Positions'}
            </button>
          ))}
        </div>

        {/* ── Stake tab ── */}
        {activeTab === 'stake' && (
          <div className="glass-panel rounded-2xl p-2 relative before:absolute before:inset-[-1px] before:-z-10 before:rounded-2xl before:bg-gradient-to-br before:from-emerald-500/15 before:to-transparent before:pointer-events-none">

            {/* You deposit */}
            <div className="bg-surface-light/50 rounded-xl p-4 border border-white/5 focus-within:border-emerald-500/30 transition-all">
              <div className="flex justify-between items-center mb-3">
                <label className="text-xs font-medium text-slate-400">You deposit</label>
                {evmAddress && (
                  <span className="text-xs text-slate-500 font-mono">
                    {evmAddress.slice(0, 6)}…{evmAddress.slice(-5)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <input
                  ref={inputRef}
                  className="bg-transparent border-none p-0 text-3xl font-medium text-white placeholder-slate-600 focus:ring-0 w-full outline-none"
                  placeholder="0" type="text" inputMode="decimal" value={amount}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9.]/g, '');
                    if ((v.match(/\./g) ?? []).length <= 1) setAmount(v);
                  }}
                  autoFocus
                />
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
              <div className="flex justify-between items-center mt-2">
                <span className="text-xs text-slate-600">
                  {quote?.fromUsd && hasValidAmount ? fmtUsd(quote.fromUsd * parseFloat(amount)) : '\u00a0'}
                </span>
                {ethBalanceFmt !== null ? (
                  <span className="text-xs text-slate-500 flex items-center gap-1.5">
                    Balance: {ethBalanceFmt}
                    <button type="button" onClick={() => setAmount(ethBalanceRaw)}
                      className="text-[10px] font-bold text-primary hover:text-primary/70 uppercase transition-colors">
                      Max
                    </button>
                  </span>
                ) : <span className="text-xs text-slate-600">Balance: —</span>}
              </div>
            </div>

            {/* Choose strategy */}
            <div className="mt-3 px-1">
              <p className="text-xs text-slate-500 mb-2">Choose strategy</p>
              <div className="space-y-2">
                {isRatesLoading ? (
                  <><ProtocolCardSkeleton /><ProtocolCardSkeleton /><ProtocolCardSkeleton /></>
                ) : rates.length > 0 ? (
                  rates.map((rate) => (
                    <ProtocolCard key={rate.id} rate={rate}
                      selected={selectedProtocol === rate.id}
                      onSelect={() => setSelectedProtocol(rate.id)} />
                  ))
                ) : (
                  (['marinade', 'marginfi'] as ProtocolId[]).map((id) => (
                    <button key={id} type="button" onClick={() => setSelectedProtocol(id)}
                      className={`w-full text-left flex items-center gap-4 p-4 rounded-xl border transition-all
                        ${selectedProtocol === id ? 'border-primary/40 bg-primary/5' : 'border-white/8 bg-white/2 hover:border-white/15'}`}>
                      <ProtocolIcon id={id} />
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold text-white text-sm capitalize">{id}</span>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-2xl font-bold text-emerald-400">— %</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">APY</div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Quote info */}
            {hasValidAmount && (quote || isQuoteLoading || quoteError) && (
              <div className="mt-3 px-1 space-y-1.5">
                {quoteError && (
                  <div className="flex items-center gap-2 text-red-400 text-xs py-1">
                    <span className="material-symbols-outlined text-sm">error</span>{quoteError}
                  </div>
                )}
                {quote && !quoteError && (
                  <>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Rate</span>
                      <span className="text-slate-300 font-medium">1 ETH ≈ {fmtRate(quote.rate)} SOL</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Estimated receive</span>
                      <span className="text-slate-300 font-medium">
                        {isQuoteLoading ? <span className="animate-pulse">…</span>
                          : `~${parseFloat(quote.estimatedReceive).toFixed(4)} ${receiveLabel}`}
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
                        {quote.priceSource === 'pyth' ? '⚡ Pyth Network' : quote.priceSource === 'coingecko' ? '🦎 CoinGecko' : 'estimate'}
                        {quoteAge !== null && (
                          <span className={`ml-2 ${quoteExpiring ? 'text-amber-400' : 'text-slate-600'}`}>
                            · {quoteAge}s ago
                          </span>
                        )}
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}

            {noSolvers && (
              <div className="mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-start gap-2">
                <span className="material-symbols-outlined text-sm shrink-0 mt-0.5">warning</span>
                <span>No solver is currently active. Your ETH would be locked with no one to fill the order.</span>
              </div>
            )}

            {/* Wallet status */}
            <div className="mt-3 space-y-1.5 px-1">
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
                  <button type="button" onClick={() => connect({ connector: connectors[0] })} disabled={isConnecting}
                    className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors">
                    {isConnecting ? 'Connecting...' : 'Connect'}
                  </button>
                </div>
              )}
              {solanaAddress ? (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                  <span>Solana: {solanaAddress.slice(0, 8)}…{solanaAddress.slice(-6)}</span>
                  {solBalance !== null && <span className="text-slate-600">· {solBalance} SOL</span>}
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-amber-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                    <span>Solana wallet not connected</span>
                  </div>
                  <div className="wallet-adapter-button-override"><WalletMultiButton /></div>
                </div>
              )}
            </div>

            {buildError && (
              <div className="mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-start gap-2">
                <span className="material-symbols-outlined text-sm shrink-0 mt-0.5">error</span>
                <span>{buildError}</span>
              </div>
            )}

            <button
              onClick={!evmConnected ? () => connect({ connector: connectors[0] }) : handleEarn}
              disabled={(evmConnected && !canEarn) || isBusy}
              className={`w-full mt-4 font-extrabold text-base py-4 rounded-xl transition-all flex items-center justify-center gap-2
                ${noSolvers
                  ? 'bg-red-500/20 border border-red-500/30 text-red-400 cursor-not-allowed'
                  : canEarn || !evmConnected
                    ? 'bg-gradient-to-r from-emerald-400 to-teal-400 hover:from-emerald-300 hover:to-teal-300 text-black shadow-[0_0_20px_rgba(52,211,153,0.25)]'
                    : 'bg-white/5 text-slate-500 cursor-not-allowed'
                }`}
            >
              {isBusy && <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />}
              {btnLabel()}
            </button>
          </div>
        )}

        {/* ── Positions tab ── */}
        {activeTab === 'positions' && (
          <div className="glass-panel rounded-2xl p-4 relative before:absolute before:inset-[-1px] before:-z-10 before:rounded-2xl before:bg-gradient-to-br before:from-emerald-500/15 before:to-transparent before:pointer-events-none">
            <PositionsTab solAddress={solanaAddress} />
          </div>
        )}

        {/* SolverAuctionCard */}
        {submitted && evmAddress && activeTab === 'stake' && (
          <div className="animate-fade-in-up">
            <SolverAuctionCard userAddress={evmAddress} submittedAt={submitted.submittedAt} />
            <div className="flex justify-between items-center mt-2 px-1">
              <a href={`https://sepolia.basescan.org/tx/${submitted.txHash}`}
                target="_blank" rel="noopener noreferrer"
                className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1 transition-colors">
                <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                View on BaseScan
              </a>
              <button onClick={handleReset}
                className="text-xs text-primary hover:text-primary/80 font-semibold transition-colors">
                New earn
              </button>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-slate-600 pb-2">
          Intent Bridge · Dutch auction · Wormhole · Base Sepolia ↔ Solana Devnet
        </p>
      </div>

      <style>{`
        .wallet-adapter-button-override .wallet-adapter-button {
          background: transparent !important; border: none !important;
          padding: 0 !important; height: auto !important;
          font-size: 12px !important; font-weight: 600 !important;
          color: rgb(13 242 223) !important; line-height: 1 !important;
        }
        .wallet-adapter-button-override .wallet-adapter-button:hover {
          background: transparent !important; opacity: 0.8;
        }
        .wallet-adapter-button-override .wallet-adapter-button-start-icon { display: none !important; }
      `}</style>
    </div>
  );
};

export default EarnPage;
