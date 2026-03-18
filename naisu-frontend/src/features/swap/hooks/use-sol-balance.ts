import { useState, useEffect, useCallback } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';

export function useSolBalance(address: string | null) {
  const { connection } = useConnection();
  const [balance, setBalance] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchBalance = useCallback(async () => {
    if (!address) {
      setBalance(null);
      return;
    }

    setIsLoading(true);
    try {
      const lamports = await connection.getBalance(new PublicKey(address));
      setBalance((lamports / 1e9).toFixed(4));
    } catch {
      setBalance(null);
    } finally {
      setIsLoading(false);
    }
  }, [connection, address]);

  useEffect(() => {
    fetchBalance();
    const id = setInterval(fetchBalance, 15_000);
    return () => clearInterval(id);
  }, [fetchBalance]);

  return { balance, isLoading, refresh: fetchBalance };
}
