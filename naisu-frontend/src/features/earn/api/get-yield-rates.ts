import { apiClient } from '@/lib/api-client';

export interface YieldRate {
  id: 'marinade' | 'jito' | 'jupsol' | 'kamino';
  name: string;
  apy: number;
  apyRaw: number;
  outputToken: string;
  receiveLabel: string;
  riskLevel: 'low' | 'medium' | 'high';
  riskLabel: string;
  description: string;
  devnetSupported: boolean;
  lastUpdated: number;
  error?: string;
}

export async function getYieldRates(): Promise<YieldRate[]> {
  return apiClient.get<YieldRate[]>('/yield/rates');
}
