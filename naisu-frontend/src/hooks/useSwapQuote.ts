/**
 * Fetch swap quote from backend when user enters amount.
 * GET /api/v1/uniswap-v4/swap/quote?tokenIn=...&tokenOut=...&amountIn=...
 */
import { useState, useEffect, useRef } from 'react';

function resolveApiBase() {
  const configured = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  const fallback = import.meta.env.DEV
    ? 'http://localhost:3000/api/v1'
    : 'https://dev-api.naisu.one/api/v1';
  const base = (configured && configured.length > 0 ? configured : fallback).replace(/\/$/, '');

  // Prevent mixed-content failures when site is served over HTTPS.
  if (typeof window !== 'undefined' && window.location.protocol === 'https:' && base.startsWith('http://')) {
    return `https://${base.slice('http://'.length)}`;
  }
  return base;
}

const API_BASE = resolveApiBase();
const DEBOUNCE_MS = 400;

/** Matches backend GET /uniswap-v4/swap/quote response (amounts in raw units) */
export interface SwapQuoteData {
  poolId: string;
  poolManager: string;
  sqrtPriceX96: string;
  tick: number;
  tickSpacing: number;
  amountIn: string;
  amountInAfterFee: string;
  expectedOutput: string;
  priceX18: string;
  priceImpact: string;
  fee: number;
  quoteMethod: 'contract' | 'fallback_math';
}

export function useSwapQuote(
  tokenIn: string,
  tokenOut: string,
  amountInRaw: string,
  enabled: boolean
) {
  const [quote, setQuote] = useState<SwapQuoteData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || !tokenIn || !tokenOut || !amountInRaw || amountInRaw === '0') {
      setQuote(null);
      setError(null);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          tokenIn,
          tokenOut,
          amountIn: amountInRaw,
        });
        const res = await fetch(`${API_BASE}/uniswap-v4/swap/quote?${params}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error?.message ?? `Quote failed: ${res.status}`);
        }
        const json = await res.json();
        if (json.success && json.data) {
          const d = json.data as Record<string, unknown>;
          setQuote({
            ...d,
            amountIn: String(d.amountIn ?? '0').split('.')[0],
            amountInAfterFee: String(d.amountInAfterFee ?? '0').split('.')[0],
            expectedOutput: String(d.expectedOutput ?? '0').split('.')[0],
          } as SwapQuoteData);
        } else {
          setQuote(null);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to get quote');
        setQuote(null);
      } finally {
        setIsLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [tokenIn, tokenOut, amountInRaw, enabled]);

  return { quote, isLoading, error };
}
