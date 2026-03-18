import { useState } from 'react';
import { useAccount, useConnect, useBalance } from 'wagmi';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { fmtUsd } from '@/lib/utils/format';
import { useSolanaAddress } from '@/hooks/useSolanaAddress';
import { useYieldRates } from '../../hooks/use-yield-rates';
import { ProtocolCard } from './protocol-card';
import type { YieldRate } from '../../api/get-yield-rates';

interface StakeTabProps {
  selectedProtocol: 'marinade' | 'marginfi';
  onProtocolChange: (protocol: 'marinade' | 'marginfi') => void;
}

export function StakeTab({ selectedProtocol, onProtocolChange }: StakeTabProps) {
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { connection } = useConnection();
  const solanaAddress = useSolanaAddress();

  const [amount, setAmount] = useState('');

  // ETH balance
  const { data: ethBalanceData } = useBalance({
    address: evmAddress,
    chainId: 84532,
  });
  const ethBalance = ethBalanceData
    ? (Number(ethBalanceData.value) / 10 ** ethBalanceData.decimals).toFixed(4)
    : null;
  const ethBalanceRaw = ethBalanceData
    ? (Number(ethBalanceData.value) / 10 ** ethBalanceData.decimals).toString()
    : '';

  // Yield rates
  const { data: rates, isLoading: isRatesLoading } = useYieldRates();

  // Filter and sort rates
  const sortedRates = rates
    ?.filter((r) => r.devnetSupported)
    .sort((a, b) => b.apy - a.apy) || [];

  const selectedRate = sortedRates.find((r) => r.id === selectedProtocol);

  return (
    <div className="space-y-4">
      {/* Amount Input */}
      <div className="bg-surface-light/50 rounded-xl p-4 border border-white/5">
        <div className="flex justify-between items-center mb-3">
          <label className="text-xs font-medium text-slate-400">You deposit</label>
          <span className="text-xs text-slate-500">Min: 0.001 ETH</span>
        </div>

        <div className="flex items-center gap-3">
          <input
            className="bg-transparent border-none p-0 text-3xl font-medium text-white placeholder-slate-600 focus:ring-0 w-full outline-none"
            placeholder="0"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9.]/g, '');
              if ((v.match(/\./g) ?? []).length <= 1) setAmount(v);
            }}
          />
          <div className="flex items-center gap-2.5 bg-surface border border-white/10 rounded-xl py-2 pl-2.5 pr-3 shrink-0">
            <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center">
              <span className="text-sm font-bold text-indigo-300">Ξ</span>
            </div>
            <div className="flex flex-col leading-tight">
              <span className="font-bold text-white text-sm">ETH</span>
              <span className="text-[10px] text-slate-500">Base Sepolia</span>
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center mt-2">
          <span className="text-xs text-slate-600">≈ $0.00</span>
          {ethBalance !== null ? (
            <span className="text-xs text-slate-500 flex items-center gap-1.5">
              Balance: {ethBalance}
              <button
                type="button"
                onClick={() => setAmount(ethBalanceRaw)}
                className="text-[10px] font-bold text-primary hover:text-primary/70 uppercase"
              >
                Max
              </button>
            </span>
          ) : (
            <span className="text-xs text-slate-600">Balance: —</span>
          )}
        </div>
      </div>

      {/* Protocol Selection */}
      <div>
        <p className="text-xs text-slate-500 mb-3">Choose strategy</p>
        <div className="space-y-2">
          {isRatesLoading ? (
            <>
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="w-full flex items-center gap-4 p-4 rounded-xl border border-white/8 bg-white/2 animate-pulse"
                >
                  <div className="w-10 h-10 rounded-full bg-white/10 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-white/10 rounded w-24" />
                    <div className="h-3 bg-white/5 rounded w-32" />
                  </div>
                  <div className="h-8 bg-white/10 rounded w-16" />
                </div>
              ))}
            </>
          ) : (
            sortedRates.map((rate) => (
              <ProtocolCard
                key={rate.id}
                rate={rate}
                selected={selectedProtocol === rate.id}
                onSelect={() => onProtocolChange(rate.id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
