import { useState, useEffect, useCallback } from 'react';

const API = ((import.meta.env.VITE_API_URL as string | undefined)?.trim()) || 'http://localhost:3000/api/v1';

export interface PortfolioBalances {
  wallet:       string;
  sol:          string;  // lamports raw
  msol:         string;  // mSOL raw (9 decimals)
  usdc:         string;  // USDC raw (6 decimals)
  msolDecimals: number;
  usdcDecimals: number;
}

export function usePortfolio(wallet: string | null) {
  const [data, setData]       = useState<PortfolioBalances | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!wallet) { setData(null); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/portfolio/balances?wallet=${wallet}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  return { data, isLoading, error, refresh };
}

/** Build unsigned Marinade liquid-unstake tx via backend */
export async function buildUnstakeMsolTx(wallet: string, amount: string): Promise<string> {
  const res = await fetch(`${API}/portfolio/unstake-msol`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ wallet, amount }),
  });
  const json = await res.json() as { tx?: string; error?: string };
  if (!res.ok || !json.tx) throw new Error(json.error ?? 'Failed to build unstake tx');
  return json.tx;
}
