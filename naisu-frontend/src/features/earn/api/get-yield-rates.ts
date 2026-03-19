import { apiClient } from '@/lib/api-client';

export interface YieldRate {
  id: 'marinade' | 'marginfi';
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
  const response = await apiClient.get<{ success: boolean; data: YieldRate[]; error?: string }>('/yield/rates');
  
  if (!response.success || !Array.isArray(response.data)) {
    throw new Error(response.error || 'Failed to fetch yield rates');
  }
  
  return response.data;
}
