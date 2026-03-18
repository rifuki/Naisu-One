import { useQuery } from '@tanstack/react-query';
import { getPortfolioBalances, type PortfolioBalances } from '../api/get-portfolio-balances';

const STALE_TIME = 15 * 1000; // 15 seconds
const REFETCH_INTERVAL = 15 * 1000; // 15 seconds

export function usePortfolioBalances(wallet: string | null) {
  return useQuery<PortfolioBalances, Error>({
    queryKey: ['earn', 'portfolio', wallet],
    queryFn: () => {
      if (!wallet) throw new Error('Wallet address required');
      return getPortfolioBalances(wallet);
    },
    enabled: !!wallet,
    staleTime: STALE_TIME,
    refetchInterval: REFETCH_INTERVAL,
  });
}
