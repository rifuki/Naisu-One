import { useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import { fmtUsd, rawToUi } from '@/lib/utils';
import { useSolanaAddress } from '@/hooks/useSolanaAddress';
import { usePositions } from "@/features/earn/hooks/use-positions";
import { useUnstakeMsol } from '@/features/earn/hooks/use-unstake-msol';

interface PositionCardProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  amount: string;
  decimals: number;
  actionLabel?: string;
  onAction?: () => void;
  isLoading?: boolean;
}

function PositionCard({ icon, title, subtitle, amount, decimals, actionLabel, onAction, isLoading }: PositionCardProps) {
  return (
    <div className="bg-surface-light/50 rounded-xl p-4 border border-white/5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          {icon}
          <div>
            <p className="font-semibold text-white">{title}</p>
            <p className="text-xs text-slate-500">{subtitle}</p>
          </div>
        </div>
      </div>
      
      <div className="flex items-center justify-between">
        <p className="text-2xl font-bold text-white">
          {isLoading ? '...' : `${rawToUi(amount, decimals)} ${title}`}
        </p>
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            disabled={isLoading || parseFloat(amount) === 0}
            className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 disabled:opacity-50"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

export default function PortfolioPage() {
  const solanaAddress = useSolanaAddress();
  const { connection } = useConnection();
  const wallet = useWallet();
  
  const { data: portfolio, isLoading, error, refetch } = usePositions(solanaAddress);
  const unstakeMutation = useUnstakeMsol();
  
  const [showUnstakeModal, setShowUnstakeModal] = useState(false);
  const [unstakeAmount, setUnstakeAmount] = useState('');
  const [txResult, setTxResult] = useState<string | null>(null);

  const handleUnstake = async () => {
    if (!solanaAddress || !wallet.signTransaction || !unstakeAmount) return;

    try {
      const txBase64 = await unstakeMutation.mutateAsync({
        wallet: solanaAddress,
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

  if (!solanaAddress) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <p className="text-slate-500 mb-4">Connect your Solana wallet to view portfolio</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Portfolio</h1>
          <p className="text-sm text-slate-500">Your Solana positions</p>
        </div>
        <button
          onClick={() => refetch()}
          className="p-2 text-slate-500 hover:text-slate-300"
          disabled={isLoading}
        >
          <span className="material-symbols-outlined">{isLoading ? 'sync' : 'refresh'}</span>
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error.message}
        </div>
      )}

      {/* Positions */}
      <div className="space-y-4">
        {portfolio && (
          <>
            <PositionCard
              icon={
                <div className="w-10 h-10 rounded-full bg-blue-400/20 flex items-center justify-center">
                  <span className="text-base font-bold text-blue-400">m</span>
                </div>
              }
              title="mSOL"
              subtitle="Marinade Staked SOL"
              amount={portfolio.msol}
              decimals={portfolio.msolDecimals}
              actionLabel="Unstake"
              onAction={() => setShowUnstakeModal(true)}
              isLoading={isLoading}
            />

            <PositionCard
              icon={
                <div className="w-10 h-10 rounded-full bg-green-400/20 flex items-center justify-center">
                  <span className="text-base font-bold text-green-400">$</span>
                </div>
              }
              title="USDC"
              subtitle="USDC Balance"
              amount={portfolio.usdc}
              decimals={portfolio.usdcDecimals}
              isLoading={isLoading}
            />

            <PositionCard
              icon={
                <div className="w-10 h-10 rounded-full bg-purple-400/20 flex items-center justify-center">
                  <span className="text-base font-bold text-purple-400">◎</span>
                </div>
              }
              title="SOL"
              subtitle="Native SOL"
              amount={portfolio.sol}
              decimals={9}
              isLoading={isLoading}
            />
          </>
        )}
      </div>

      {/* Unstake Modal */}
      {showUnstakeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowUnstakeModal(false)} />
          <div className="relative bg-surface rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold text-white mb-4">Unstake mSOL</h3>
            <input
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
        <div className="mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
          Transaction sent!{' '}
          <a
            href={`https://explorer.solana.com/tx/${txResult}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            View on Explorer
          </a>
        </div>
      )}
    </div>
  );
}
