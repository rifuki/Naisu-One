import React, { useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Transaction } from '@solana/web3.js';
import { useSolanaAddress } from '@/hooks/useSolanaAddress';
import { usePortfolio, buildUnstakeMsolTx } from '@/hooks/usePortfolio';

// ── Helpers ───────────────────────────────────────────────────────────────────

function rawToUi(raw: string, decimals: number): string {
  if (!raw || raw === '0') return '0';
  const n = Number(BigInt(raw)) / 10 ** decimals;
  return n < 0.0001 ? n.toExponential(4) : n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function lamportsToSol(raw: string): string {
  return rawToUi(raw, 9);
}

// ── Position Card ─────────────────────────────────────────────────────────────

interface PositionCardProps {
  icon:       React.ReactNode;
  title:      string;
  subtitle:   string;
  amount:     string;
  symbol:     string;
  badge?:     string;
  badgeColor?: string;
  actionLabel?: string;
  actionColor?: string;
  onAction?:  () => void;
  actionLoading?: boolean;
  actionDisabled?: boolean;
  extraInfo?: React.ReactNode;
}

function PositionCard({
  icon, title, subtitle, amount, symbol,
  badge, badgeColor = 'text-green-400 bg-green-400/10',
  actionLabel, actionColor = 'bg-primary/10 border-primary/30 text-primary hover:bg-primary/20',
  onAction, actionLoading, actionDisabled,
  extraInfo,
}: PositionCardProps) {
  return (
    <div className="bg-[#0c1a18]/60 border border-white/8 rounded-2xl p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          {icon}
          <div>
            <div className="font-semibold text-white text-sm">{title}</div>
            <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>
          </div>
        </div>
        {badge && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeColor}`}>
            {badge}
          </span>
        )}
      </div>

      <div className="flex items-end justify-between">
        <div>
          <div className="text-2xl font-bold text-white tabular-nums">{amount}</div>
          <div className="text-xs text-slate-500 mt-0.5">{symbol}</div>
        </div>
        {actionLabel && (
          <button
            onClick={onAction}
            disabled={actionDisabled || actionLoading}
            className={`text-xs font-semibold px-4 py-2 rounded-xl border transition-all
              ${actionDisabled || actionLoading
                ? 'opacity-40 cursor-not-allowed bg-white/5 border-white/10 text-slate-400'
                : actionColor}`}
          >
            {actionLoading ? (
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                Building…
              </span>
            ) : actionLabel}
          </button>
        )}
      </div>

      {extraInfo && (
        <div className="border-t border-white/5 pt-3">{extraInfo}</div>
      )}
    </div>
  );
}

// ── Unstake Modal ─────────────────────────────────────────────────────────────

interface UnstakeModalProps {
  maxRaw:    string;
  decimals:  number;
  symbol:    string;
  onClose:  () => void;
  onConfirm: (amountRaw: string) => Promise<void>;
}

function UnstakeModal({ maxRaw, decimals, symbol, onClose, onConfirm }: UnstakeModalProps) {
  const maxUi = rawToUi(maxRaw, decimals);
  const [input, setInput]     = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState('');

  const amountRaw = input
    ? String(BigInt(Math.floor(parseFloat(input) * 10 ** decimals)))
    : '0';
  const valid = input && parseFloat(input) > 0 && BigInt(amountRaw) <= BigInt(maxRaw);

  async function handleConfirm() {
    if (!valid) return;
    setLoading(true);
    setErr('');
    try {
      await onConfirm(amountRaw);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#0c1a18] border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-white">Unstake {symbol}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="text-xs text-slate-500 mb-1.5 flex justify-between">
          <span>Amount</span>
          <button
            onClick={() => setInput(maxUi.replace(/,/g, ''))}
            className="text-primary hover:underline"
          >
            Max: {maxUi}
          </button>
        </div>
        <div className="flex gap-2 items-center bg-white/5 border border-white/10 rounded-xl px-4 py-3 mb-4">
          <input
            type="number"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="0.00"
            className="bg-transparent flex-1 text-white text-sm outline-none placeholder:text-slate-600"
          />
          <span className="text-slate-400 text-sm font-medium">{symbol}</span>
        </div>

        <div className="text-xs text-slate-500 bg-white/4 border border-white/8 rounded-xl px-3 py-2.5 mb-4 space-y-1">
          <div className="flex justify-between">
            <span className="text-slate-500">You send</span>
            <span className="text-white font-medium">{input || '0'} mSOL</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">You receive (est.)</span>
            <span className="text-green-400 font-medium">~{input ? (parseFloat(input) * 0.997).toFixed(6) : '0'} SOL</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Fee</span>
            <span className="text-slate-400">~0.3% (Marinade liq. pool)</span>
          </div>
          <div className="border-t border-white/5 pt-1.5 mt-1 text-[10px] text-slate-600">
            ⚠ Phantom shows mSOL as "Unknown" on devnet — this is normal. The tx is correct.
          </div>
        </div>

        {err && (
          <div className="text-xs text-red-400 bg-red-400/10 rounded-xl px-3 py-2 mb-3">
            {err}
          </div>
        )}

        <button
          onClick={handleConfirm}
          disabled={!valid || loading}
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

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const solAddress                    = useSolanaAddress();
  const { connection }                = useConnection();
  const { signTransaction, connected } = useWallet();
  const { data, isLoading, error, refresh } = usePortfolio(solAddress);

  const [showUnstakeModal, setShowUnstakeModal] = useState(false);
  const [txResult, setTxResult]                 = useState<{ sig: string; action: string } | null>(null);
  const [actionErr, setActionErr]               = useState<string | null>(null);

  async function handleUnstake(amountRaw: string) {
    if (!solAddress || !signTransaction) throw new Error('Wallet not connected');

    // 1. Ask backend to build unsigned tx
    const base64 = await buildUnstakeMsolTx(solAddress, amountRaw);

    // 2. Deserialize (browser-safe — no Buffer)
    const binary = atob(base64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const tx = Transaction.from(bytes);

    // 3. Sign with user wallet
    const signed = await signTransaction(tx);

    // 4. Send + confirm
    const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
    await connection.confirmTransaction(sig, 'confirmed');

    setTxResult({ sig, action: 'Unstake mSOL → SOL' });
    refresh();
  }

  // ── No wallet ──────────────────────────────────────────────────────────────
  if (!solAddress) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8 text-center">
        <div className="bg-[#0c1a18]/60 border border-white/8 rounded-2xl p-10">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <span className="material-symbols-outlined text-primary text-2xl">account_balance_wallet</span>
          </div>
          <h2 className="text-lg font-bold text-white mb-2">Connect Solana Wallet</h2>
          <p className="text-slate-500 text-sm mb-6">Connect your Solana wallet to view your DeFi positions.</p>
          <WalletMultiButton />
        </div>
      </div>
    );
  }

  const msolUi = data ? rawToUi(data.msol, data.msolDecimals) : '—';
  const usdcUi = data ? rawToUi(data.usdc, data.usdcDecimals) : '—';
  const solUi  = data ? lamportsToSol(data.sol) : '—';
  const hasMsol = data && BigInt(data.msol) > 0n;
  const hasUsdc = data && BigInt(data.usdc) > 0n;

  return (
    <div className="max-w-2xl mx-auto px-4 py-2">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Portfolio</h1>
          <div className="text-xs text-slate-500 font-mono mt-0.5">
            {solAddress.slice(0, 8)}…{solAddress.slice(-6)}
          </div>
        </div>
        <button
          onClick={refresh}
          disabled={isLoading}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-white transition-colors"
        >
          <span className={`material-symbols-outlined text-sm ${isLoading ? 'animate-spin' : ''}`}>
            refresh
          </span>
          {isLoading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="text-xs text-red-400 bg-red-400/10 rounded-xl px-4 py-3 mb-4">
          {error}
        </div>
      )}

      {/* Tx result banner */}
      {txResult && (
        <div className="flex items-center justify-between bg-green-400/10 border border-green-400/20 rounded-xl px-4 py-3 mb-4">
          <div>
            <div className="text-xs font-semibold text-green-400">{txResult.action} confirmed</div>
            <a
              href={`https://explorer.solana.com/tx/${txResult.sig}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-slate-500 hover:text-primary font-mono underline"
            >
              {txResult.sig.slice(0, 16)}…
            </a>
          </div>
          <button onClick={() => setTxResult(null)} className="text-slate-500 hover:text-white">
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      )}

      {/* Action error */}
      {actionErr && (
        <div className="text-xs text-red-400 bg-red-400/10 rounded-xl px-4 py-3 mb-4">
          {actionErr}
          <button onClick={() => setActionErr(null)} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* Position cards */}
      <div className="flex flex-col gap-4">
        {/* mSOL — Marinade */}
        <PositionCard
          icon={
            <div className="w-10 h-10 rounded-full bg-blue-400/20 flex items-center justify-center shrink-0">
              <span className="text-base font-bold text-blue-400">m</span>
            </div>
          }
          title="mSOL"
          subtitle="Marinade Finance · Liquid Staking"
          amount={msolUi}
          symbol="mSOL"
          badge={hasMsol ? 'Earning' : undefined}
          actionLabel={hasMsol && connected ? 'Unstake' : undefined}
          actionColor="bg-blue-400/10 border-blue-400/30 text-blue-300 hover:bg-blue-400/20"
          onAction={() => setShowUnstakeModal(true)}
          extraInfo={
            <div className="text-xs text-slate-600">
              Instant unstake available · ~0.3% fee · You receive SOL
            </div>
          }
        />

        {/* USDC — Orca */}
        <PositionCard
          icon={
            <div className="w-10 h-10 rounded-full bg-teal-400/20 flex items-center justify-center shrink-0">
              <span className="text-base font-bold text-teal-400">$</span>
            </div>
          }
          title="USDC"
          subtitle="Orca Whirlpool · SOL/USDC LP"
          amount={usdcUi}
          symbol="USDC"
          badge={hasUsdc ? 'Active' : undefined}
          badgeColor="text-teal-400 bg-teal-400/10"
          actionLabel={hasUsdc ? 'Manage on Orca ↗' : undefined}
          actionColor="bg-teal-400/10 border-teal-400/30 text-teal-300 hover:bg-teal-400/20"
          onAction={() => window.open('https://www.orca.so/?tokenIn=SOL&tokenOut=USDC', '_blank')}
          extraInfo={
            <div className="text-xs text-slate-600">
              Swap back to SOL on Orca · devnet USDC
            </div>
          }
        />

        {/* SOL — Native */}
        <PositionCard
          icon={
            <div className="w-10 h-10 rounded-full bg-purple-400/20 flex items-center justify-center shrink-0">
              <svg width="18" height="18" viewBox="0 0 128 128" fill="none">
                <path d="M21.1 94.5c.8-.8 1.9-1.3 3.1-1.3h89.5c2 0 3 2.4 1.6 3.8L98 114.3c-.8.8-1.9 1.3-3.1 1.3H5.4c-2 0-3-2.4-1.6-3.8L21.1 94.5z" fill="url(#ps1)"/>
                <path d="M21.1 13.7C21.9 12.9 23 12.4 24.2 12.4h89.5c2 0 3 2.4 1.6 3.8L98 33.5c-.8.8-1.9 1.3-3.1 1.3H5.4c-2 0-3-2.4-1.6-3.8L21.1 13.7z" fill="url(#ps2)"/>
                <path d="M98 53.9c-.8-.8-1.9-1.3-3.1-1.3H5.4c-2 0-3 2.4-1.6 3.8l17.3 17.3c.8.8 1.9 1.3 3.1 1.3h89.5c2 0 3-2.4 1.6-3.8L98 53.9z" fill="url(#ps3)"/>
                <defs>
                  <linearGradient id="ps1" x1="0" y1="128" x2="128" y2="0" gradientUnits="userSpaceOnUse"><stop stopColor="#9945FF"/><stop offset="1" stopColor="#14F195"/></linearGradient>
                  <linearGradient id="ps2" x1="0" y1="128" x2="128" y2="0" gradientUnits="userSpaceOnUse"><stop stopColor="#9945FF"/><stop offset="1" stopColor="#14F195"/></linearGradient>
                  <linearGradient id="ps3" x1="0" y1="128" x2="128" y2="0" gradientUnits="userSpaceOnUse"><stop stopColor="#9945FF"/><stop offset="1" stopColor="#14F195"/></linearGradient>
                </defs>
              </svg>
            </div>
          }
          title="SOL"
          subtitle="Solana Devnet · Native"
          amount={solUi}
          symbol="SOL"
        />

        {/* marginfi placeholder */}
        <div className="bg-[#0c1a18]/40 border border-white/5 rounded-2xl p-5 opacity-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-orange-400/10 flex items-center justify-center shrink-0">
              <span className="text-base font-bold text-orange-400/60">f</span>
            </div>
            <div>
              <div className="font-semibold text-slate-400 text-sm">marginfi</div>
              <div className="text-xs text-slate-600 mt-0.5">Lending position · Coming soon</div>
            </div>
          </div>
        </div>
      </div>

      {/* Unstake modal */}
      {showUnstakeModal && data && (
        <UnstakeModal
          maxRaw={data.msol}
          decimals={data.msolDecimals}
          symbol="mSOL"
          onClose={() => setShowUnstakeModal(false)}
          onConfirm={async (amountRaw) => {
            setActionErr(null);
            try {
              await handleUnstake(amountRaw);
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              setActionErr(msg);
              throw e;
            }
          }}
        />
      )}
    </div>
  );
}
