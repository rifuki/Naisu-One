import { apiClient } from '@/lib/api-client'

export interface GaslessIntent {
  creator: string
  recipient: string
  destinationChain: number
  amount: string
  startPrice: string
  floorPrice: string
  deadline: number
  intentType: number
  nonce: number
}

export interface SubmitSignatureParams {
  intent: GaslessIntent
  signature: string
}

export interface SubmitSignatureResponse {
  intentId: string
  status: 'rfq_active' | 'pending_rfq'
  estimatedFillTime: number
  message: string
}

export async function submitIntentSignature(
  params: SubmitSignatureParams
): Promise<SubmitSignatureResponse> {
  return apiClient.post<SubmitSignatureResponse>('/intent/submit-signature', params)
}

export async function getUserNonce(address: string): Promise<number> {
  try {
    const data = await apiClient.get<{ nonce: number }>('/intent/nonce', { address })
    return data.nonce
  } catch {
    return 0
  }
}
