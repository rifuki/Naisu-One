import { useQuery } from '@tanstack/react-query';
import { getYieldRates, type YieldRate } from '../api/get-yield-rates';

const STALE_TIME = 60 * 1000; // 1 minute
const REFETCH_INTERVAL = 60 * 1000; // 1 minute

export function useYieldRates() {
  return useQuery<YieldRate[], Error>({
    queryKey: ['earn', 'yield-rates'],
    queryFn: getYieldRates,
    staleTime: STALE_TIME,
    refetchInterval: REFETCH_INTERVAL,
  });
}
