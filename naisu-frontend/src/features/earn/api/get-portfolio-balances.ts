import { apiClient } from '@/lib/api-client';

export interface PortfolioBalances {
  wallet: string;
  sol: string;
  msol: string;
  usdc: string;
  marginfiSol: string; // SOL lamports lent in marginfi
  msolDecimals: number;
  usdcDecimals: number;
}

export async function getPortfolioBalances(wallet: string): Promise<PortfolioBalances> {
  const response = await apiClient.get<{ data: PortfolioBalances }>('/portfolio/balances', { wallet });
  return response.data;
}

export async function buildUnstakeMsolTx(wallet: string, amount: string): Promise<string> {
  const response = await apiClient.post<{ tx?: string; error?: string }>('/portfolio/unstake-msol', {
    wallet,
    amount,
  });
  
  if (!response.tx) {
    throw new Error(response.error || 'Failed to build unstake transaction');
  }
  
  return response.tx;
}
