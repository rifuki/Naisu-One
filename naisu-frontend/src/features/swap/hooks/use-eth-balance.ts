import { useState, useEffect, useCallback } from 'react';
import { useAccount, useBalance as useWagmiBalance } from 'wagmi';

export function useEthBalance() {
  const { address } = useAccount();
  const { data, isLoading, refetch } = useWagmiBalance({
    address,
    chainId: 84532, // Base Sepolia
  });

  const formatted = data
    ? (Number(data.value) / 10 ** data.decimals).toFixed(4)
    : null;

  const raw = data
    ? (Number(data.value) / 10 ** data.decimals).toString()
    : '';

  return {
    balance: formatted,
    raw,
    isLoading,
    refresh: refetch,
  };
}
