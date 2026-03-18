import { useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import { fmtUsd, rawToUi } from '@/lib/utils/format';
import { usePortfolioBalances } from '../../hooks/use-portfolio-balances';
import { useUnstakeMsol } from '../../hooks/use-unstake-msol';

interface PositionsTabProps {
  solAddress: string | null;
}

export function PositionsTab({ solAddress }: PositionsTabProps) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { data: portfolio, isLoading, error, refetch } = usePortfolioBalances(solAddress);
  const unstakeMutation = useUnstakeMsol();

  const [unstakeAmount, setUnstakeAmount] = useState('');
  const [showUnstakeModal, setShowUnstakeModal] = useState(false);
  const [txResult, setTxResult] = useState<string | null>(null);

  const handleUnstake = async () => {
    if (!solAddress || !wallet.signTransaction || !unstakeAmount) return;

    try {
      const txBase64 = await unstakeMutation.mutateAsync({
        wallet: solAddress,
        amount: unstakeAmount,
      });

      const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, 'base64'));
      const signed = await wallet.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());

      await connection.confirmTransaction(sig, 'confirmed');
      setTxResult(sig);
      setShowUnstakeModal(false);
      setUnstakeAmount('');
      refetch();
    } catch (err) {
      console.error('Unstake failed:', err);
    }
  };

  if (!solAddress) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-500">Connect your Solana wallet to view positions</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">{solAddress.slice(0, 8)}…{solAddress.slice(-6)}</span>
        </div>
        <button
          onClick={() => refetch()}
          className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors"
          disabled={isLoading}
        >
          <span className="material-symbols-outlined text-[18px]">{isLoading ? 'sync' : 'refresh'}</span>
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
          {error.message}
        </div>
      )}

      {/* mSOL Card */}
      {portfolio && (
        <div className="bg-surface-light/50 rounded-xl p-4 border border-white/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-400/20 flex items-center justify-center">
                <span className="text-base font-bold text-blue-400">m</span>
              </div>
              <div>
                <p className="font-semibold text-white">mSOL</p>
                <p className="text-xs text-slate-500">Marinade Staked SOL</p>
              </div>
            </div>            <div className="text-right">
              <p className="text-xl font-bold text-white">
                {rawToUi(portfolio.msol, portfolio.msolDecimals)} mSOL
              </p>              <p className="text-xs text-emerald-400">Earning yield</p>
            </div>
          </div>

          {parseFloat(portfolio.msol) > 0 && (
            <button
              onClick={() => setShowUnstakeModal(true)}
              className="w-full mt-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 hover:text-white transition-all"
            >
              Unstake to SOL
            </button>
          )}
        </div>
      )}

      {/* SOL Card */}
      {portfolio && (
        <div className="bg-surface-light/50 rounded-xl p-4 border border-white/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-purple-400/20 flex items-center justify-center">
                <span className="text-base font-bold text-purple-400">◎</span>
              </div>
              <div>
                <p className="font-semibold text-white">SOL</p>
                <p className="text-xs text-slate-500">Native SOL</p>
              </div>
            </div>            <div className="text-right">
              <p className="text-xl font-bold text-white">
                {rawToUi(portfolio.sol, 9)} SOL
              </p>            </div>
          </div>
        </div>
      )}

      {/* Unstake Modal */}
      {showUnstakeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowUnstakeModal(false)} />
          <div className="relative bg-surface rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold text-white mb-4">Unstake mSOL</h3>            <input
              type="text"
              value={unstakeAmount}
              onChange={(e) => setUnstakeAmount(e.target.value)}
              placeholder="Amount in mSOL"
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={() => setShowUnstakeModal(false)}
                className="flex-1 py-2 rounded-xl bg-white/5 text-slate-400 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={handleUnstake}
                disabled={!unstakeAmount || unstakeMutation.isPending}
                className="flex-1 py-2 rounded-xl bg-primary text-black font-semibold disabled:opacity-50"
              >
                {unstakeMutation.isPending ? 'Processing...' : 'Unstake'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tx Result */}
      {txResult && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs">
          Transaction sent: {txResult.slice(0, 8)}…{txResult.slice(-8)}
        </div>
      )}
    </div>
  );
}
