import { useState, useEffect, useRef, useCallback } from 'react';

const API = ((import.meta.env.VITE_API_URL as string | undefined)?.trim()) || 'http://localhost:3000/api/v1';

export interface IntentQuote {
  fromChain: string;
  toChain: string;
  amountIn: string;
  amountInRaw: string;
  estimatedReceive: string;
  floorPrice: string;
  currentAuctionPrice: string | null;
  fromUsd: number | null;
  toUsd: number | null;
  rate: number | null;
  confidence: number | null;
  priceSource: 'pyth' | 'coingecko' | 'fallback';
  activeSolvers: number;
  durationMs: number;
}

const REFRESH_INTERVAL_MS = 30_000;

export function useIntentQuote(amount: string) {
  const [quote, setQuote] = useState<IntentQuote | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number>(0);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchQuote = useCallback(async (amt: string) => {
    const parsed = parseFloat(amt);
    if (!amt || isNaN(parsed) || parsed <= 0) {
      setQuote(null);
      setError(null);
      setLastFetch(0);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API}/intent/quote?fromChain=evm-base&toChain=solana&amount=${encodeURIComponent(amt)}&token=native`
      );
      const json = await res.json();
      if (json.success) {
        setQuote(json.data);
        setLastFetch(Date.now());
      } else {
        setError(json.error ?? 'Quote failed');
        setQuote(null);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setQuote(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Debounce amount changes (500ms)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchQuote(amount), 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [amount, fetchQuote]);

  // Auto-refresh every 30s
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      if (amount && parseFloat(amount) > 0) fetchQuote(amount);
    }, REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [amount, fetchQuote]);

  const refresh = useCallback(() => fetchQuote(amount), [amount, fetchQuote]);

  return { quote, isLoading, error, lastFetch, refresh };
}
