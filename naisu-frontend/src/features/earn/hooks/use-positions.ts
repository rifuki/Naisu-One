import { useQuery } from '@tanstack/react-query';
import { getPortfolioBalances, type PortfolioBalances } from '../api/get-portfolio-balances';

export type { PortfolioBalances };

export function usePositions(solWallet: string | null) {
  return useQuery<PortfolioBalances, Error>({
    queryKey: ['earn', 'positions', solWallet],
    queryFn: () => {
      if (!solWallet) throw new Error('Wallet address required');
      return getPortfolioBalances(solWallet);
    },
    enabled: !!solWallet,
    staleTime: 15_000,
    refetchInterval: 15_000,
  });
}
