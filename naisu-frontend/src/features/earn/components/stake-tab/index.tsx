import { useState } from 'react';
import { useAccount, useConnect, useBalance, useSendTransaction } from 'wagmi';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { useSolanaAddress } from '@/hooks/use-solana-address';
import { apiClient } from '@/lib/api/client';
import { useYieldRates } from '../../hooks/use-yield-rates';
import { ProtocolCard } from './protocol-card';
import { useSwapOrder } from '@/features/swap/hooks/use-swap-order';

type Protocol = 'marinade' | 'jito' | 'jupsol' | 'kamino';

type OutputToken = 'sol' | 'msol' | 'jito' | 'jupsol' | 'kamino';

const PROTOCOL_OUTPUT_TOKEN: Record<Protocol, OutputToken> = {
  marinade: 'msol',
  jito:     'jito',
  jupsol:   'jupsol',
  kamino:   'kamino',
};

interface StakeTabProps {
  selectedProtocol: Protocol;
  onProtocolChange: (protocol: Protocol) => void;
}

export function StakeTab({ selectedProtocol, onProtocolChange }: StakeTabProps) {
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
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

  // ETH USD price
  const { data: priceData } = useQuery<{ fromUsd: number }>({
    queryKey: queryKeys.prices.eth(),
    queryFn: async () => {
      const json = await apiClient.get<{ fromUsd: number }>('/intent/price', {
        fromChain: 'base_sepolia', toChain: 'solana',
      });
      return { fromUsd: json.fromUsd ?? 0 };
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const ethUsdPrice = priceData?.fromUsd ?? 0;
  const usdValue = Number(amount) > 0 && ethUsdPrice > 0
    ? `≈ $${(Number(amount) * ethUsdPrice).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
    : '≈ $0.00';

  // Yield rates
  const { data: rates, isLoading: isRatesLoading } = useYieldRates();

  // Sort rates
  const sortedRates = rates?.slice().sort((a, b) => b.apy - a.apy) || [];

  // Submit Logic
  const { mutateAsync: submitOrder, isPending: isSubmitting, error: buildError } = useSwapOrder();
  const { sendTransactionAsync, isPending: isSigning } = useSendTransaction();
  const isBusy = isSubmitting || isSigning;
  const canSubmit = evmConnected && !!solanaAddress && Number(amount) > 0;

  const handleSubmit = async () => {
    if (!evmAddress || !solanaAddress || !amount) return;
    try {
      const result = await submitOrder({
        evmAddress,
        solanaAddress,
        amount,
        outputToken: PROTOCOL_OUTPUT_TOKEN[selectedProtocol],
      });

      const hash = await sendTransactionAsync({
        to: result.tx.to as `0x${string}`,
        data: result.tx.data as `0x${string}`,
        value: BigInt(result.tx.value),
        chainId: result.tx.chainId,
      });
      // App handles Active Intents overlay, we just reset here or optionally show toast
      setAmount('');
    } catch (e: any) {
      console.error(e);
    }
  };

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
          <span className="text-xs text-slate-600">{usdValue}</span>
          {ethBalance !== null ? (
            <span className="text-xs text-slate-500 flex items-center gap-1.5">
              Balance: {ethBalance}
              <Button
                type="button"
                onClick={() => setAmount(ethBalanceRaw)}
                className="text-[10px] font-bold text-primary hover:text-primary/70 uppercase"
              >
                Max
              </Button>
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
                onSelect={() => onProtocolChange(rate.id as Protocol)}
              />
            ))
          )}
        </div>
      </div>

      {/* Submit Button */}
      <div className="pt-2">
        {buildError && (
          <div className="mb-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-start gap-2">
            <span className="material-symbols-outlined text-sm shrink-0 mt-0.5">error</span>
            <span>{buildError.message}</span>
          </div>
        )}
        <Button
          onClick={!evmConnected ? () => connect({ connector: connectors[0] }) : handleSubmit}
          disabled={evmConnected && (!canSubmit || isBusy)}
          className={`w-full font-extrabold text-base py-4 rounded-xl transition-all flex items-center justify-center gap-2
            ${
              canSubmit || !evmConnected
                ? 'bg-gradient-to-r from-teal-400 to-cyan-400 hover:from-teal-300 hover:to-cyan-300 text-black shadow-[0_0_20px_rgba(13,242,223,0.25)]'
                : 'bg-white/5 text-slate-500 cursor-not-allowed'
            }`}
        >
          {isBusy && <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />}
          {!evmConnected 
            ? 'Connect EVM Wallet' 
            : !solanaAddress 
              ? 'Connect Solana Wallet' 
              : Number(amount) <= 0 
                ? 'Enter Amount' 
                : 'Deposit & Earn →'}
        </Button>
      </div>
    </div>
  );
}
