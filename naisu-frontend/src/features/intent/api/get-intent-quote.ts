import { apiClient } from '@/lib/api-client'

export interface GetIntentQuoteParams {
  amount: string
  fromChain?: string
  toChain?: string
  token?: string
}

export interface IntentQuote {
  fromChain: string
  toChain: string
  amountIn: string
  amountInRaw: string
  estimatedReceive: string
  floorPrice: string
  currentAuctionPrice: string | null
  fromUsd: number | null
  toUsd: number | null
  rate: number | null
  confidence: number | null
  priceSource: 'pyth' | 'coingecko' | 'fallback'
  activeSolvers: number
  durationMs: number
}

export async function getIntentQuote(params: GetIntentQuoteParams): Promise<IntentQuote> {
  const { amount, fromChain = 'evm-base', toChain = 'solana', token = 'native' } = params
  
  const response = await apiClient.get<{ success: boolean; data: IntentQuote; error?: string }>(
    '/intent/quote',
    {
      fromChain,
      toChain,
      amount,
      token,
    }
  )
  
  if (!response.success) {
    throw new Error(response.error || 'Failed to get quote')
  }
  
  return response.data
}
