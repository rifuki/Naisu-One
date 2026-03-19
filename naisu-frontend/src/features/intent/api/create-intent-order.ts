import { apiClient } from '@/lib/api-client'

export interface CreateIntentOrderParams {
  senderAddress: string
  recipientAddress: string
  destinationChain: string
  amount: string
  outputToken: 'sol' | 'msol' | 'marginfi'
}

export interface BuiltTx {
  to: string
  data: string
  value: string
  chainId: number
}

export interface CreateIntentOrderResponse {
  tx: BuiltTx
}

export async function createIntentOrder(
  params: CreateIntentOrderParams
): Promise<CreateIntentOrderResponse> {
  const response = await apiClient.post<{ success: boolean; data: CreateIntentOrderResponse; error?: string }>(
    '/intent/build-tx',
    {
      chain: 'evm-base',
      action: 'create_order',
      ...params,
    }
  )
  
  if (!response.success) {
    throw new Error(response.error || 'Failed to build transaction')
  }
  
  return response.data
}
