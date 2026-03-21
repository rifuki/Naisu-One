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

interface BackendQuote {
  fromUsd: number | null
  toUsd: number | null
  startPrice: string
  floorPrice: string
  amount: string
  receiveAmount: string
  durationSeconds: number
  activeSolvers: number
}

export async function getIntentQuote(params: GetIntentQuoteParams): Promise<IntentQuote> {
  const { amount, fromChain = 'evm-base', toChain = 'solana', token = 'native' } = params
  const raw = await apiClient.get<BackendQuote>('/intent/quote', { fromChain, toChain, amount, token })

  const rate = raw.fromUsd && raw.toUsd ? raw.fromUsd / raw.toUsd : null

  return {
    fromChain,
    toChain,
    amountIn: amount,
    estimatedReceive: raw.receiveAmount ?? '0',
    floorPrice: raw.floorPrice ?? '0',
    currentAuctionPrice: null,
    fromUsd: raw.fromUsd ?? null,
    toUsd: raw.toUsd ?? null,
    rate,
    confidence: null,
    priceSource: 'fallback',
    activeSolvers: raw.activeSolvers ?? 0,
    durationMs: (raw.durationSeconds ?? 300) * 1000,
  }
}
