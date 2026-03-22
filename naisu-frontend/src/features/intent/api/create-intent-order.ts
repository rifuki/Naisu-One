import { apiClient } from '@/lib/api/client'

export interface CreateIntentOrderParams {
  senderAddress: string
  recipientAddress: string
  destinationChain: string
  amount: string
  outputToken: 'sol' | 'msol' | 'jito' | 'jupsol' | 'kamino'
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
  return apiClient.post<CreateIntentOrderResponse>('/intent/build-tx', {
    chain: 'evm-base',
    action: 'create_order',
    ...params,
  })
}
