import { useState, useEffect, useRef, useCallback } from 'react';

const API = ((import.meta.env.VITE_API_URL as string | undefined)?.trim()) || 'http://localhost:3000/api/v1';

// ── Types (mirrors backend ProtocolRate) ─────────────────────────────────────

export interface ProtocolRate {
  id: 'marinade' | 'marginfi';
  name: string;
  apy: number;          // percentage (e.g. 6.82 for 6.82%)
  apyRaw: number;       // raw decimal from API (e.g. 0.0682)
  outputToken: string;  // 'msol' | 'marginfi'
  receiveLabel: string; // 'mSOL' | 'SOL (marginfi)'
  riskLevel: 'low' | 'medium' | 'high';
  riskLabel: string;    // 'Liquid staking' | 'Variable lending' | 'LP + IL risk'
  description: string;
  devnetSupported: boolean;
  lastUpdated: number;  // unix ms
  error?: string;       // present if API fetch used fallback
}

// ── Hook ─────────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 60_000; // 1 minute

export function useYieldRates() {
  const [rates, setRates] = useState<ProtocolRate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number>(0);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRates = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/yield/rates`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setRates(json.data);
        setLastFetch(Date.now());
      } else {
        setError(json.error ?? 'Failed to fetch yield rates');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchRates();
  }, [fetchRates]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(fetchRates, REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchRates]);

  const refresh = useCallback(() => fetchRates(), [fetchRates]);

  return { rates, isLoading, error, lastFetch, refresh };
}
