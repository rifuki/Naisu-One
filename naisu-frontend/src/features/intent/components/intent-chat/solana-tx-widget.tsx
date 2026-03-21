import { useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';

interface SolanaTxWidgetProps {
  tx: string;           // base64-encoded VersionedTransaction
  action: string;       // e.g. "unstake_msol"
  description: string;  // e.g. "Unstake 1.00 mSOL → SOL"
}

const ACTION_LABELS: Record<string, string> = {
  unstake_msol: 'Sign & Unstake',
};

const ACTION_SUBTITLES: Record<string, string> = {
  unstake_msol: 'Solana devnet · Marinade liquid unstake',
};

export function SolanaTxWidget({ tx, action, description }: SolanaTxWidgetProps) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [status, setStatus] = useState<'idle' | 'signing' | 'sending' | 'success' | 'error'>('idle');
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSign = async () => {
    if (!wallet.signTransaction) return;
    setStatus('signing');
    setError(null);
    try {
      const decoded = Buffer.from(tx, 'base64');
      const versioned = VersionedTransaction.deserialize(decoded);
      const signed = await wallet.signTransaction(versioned);
      setStatus('sending');
      const sig = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(sig, 'confirmed');
      setSignature(sig);
      setStatus('success');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Transaction failed';
      setError(msg);
      setStatus('error');
    }
  };

  const btnLabel = ACTION_LABELS[action] ?? 'Sign & Send';
  const subtitle = ACTION_SUBTITLES[action] ?? 'Solana devnet';
  const isBusy = status === 'signing' || status === 'sending';

  if (status === 'success' && signature) {
    return (
      <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-4 space-y-1">
        <div className="flex items-center gap-2 text-emerald-400">
          <span className="material-symbols-outlined text-[18px]">check_circle</span>
          <span className="font-semibold text-sm">Transaction confirmed!</span>
        </div>
        <p className="text-slate-400 text-xs font-mono pl-6">
          {signature.slice(0, 8)}…{signature.slice(-8)}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-[#0d1614] border border-white/8 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-primary text-[18px]">currency_exchange</span>
        <span className="text-white font-semibold text-sm">{description}</span>
      </div>

      {error && (
        <p className="text-xs text-red-400 flex items-start gap-1.5">
          <span className="material-symbols-outlined text-[14px] shrink-0 mt-0.5">error</span>
          {error}
        </p>
      )}

      <button
        onClick={handleSign}
        disabled={isBusy || !wallet.signTransaction}
        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-teal-400 to-cyan-400 text-black font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2 transition-opacity"
      >
        {isBusy && (
          <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
        )}
        {status === 'signing' ? 'Waiting for wallet…'
          : status === 'sending' ? 'Sending…'
          : btnLabel}
      </button>

      <p className="text-[10px] text-slate-600 text-center">{subtitle}</p>
    </div>
  );
}
