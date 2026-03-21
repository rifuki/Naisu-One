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
  return apiClient.get<PortfolioBalances>('/portfolio/balances', { wallet });
}

export async function buildUnstakeMsolTx(wallet: string, amount: string): Promise<string> {
  const response = await apiClient.post<{ tx: string }>('/portfolio/unstake-msol', { wallet, amount });
  return response.tx;
}
