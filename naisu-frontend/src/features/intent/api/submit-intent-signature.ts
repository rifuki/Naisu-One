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

/**
 * Submit a gasless intent with EIP-712 signature to the backend.
 * The backend will verify the signature and run RFQ with solvers.
 */
export async function submitIntentSignature(
  params: SubmitSignatureParams
): Promise<SubmitSignatureResponse> {
  const response = await apiClient.post<{ success: boolean; data: SubmitSignatureResponse; error?: string }>(
    '/intent/submit-signature',
    params
  )
  
  if (!response.success) {
    throw new Error(response.error || 'Failed to submit signature')
  }
  
  return response.data
}

/**
 * Get the current nonce for a user address.
 * Used to prevent replay attacks.
 */
export async function getUserNonce(address: string): Promise<number> {
  // For now, we'll fetch nonce from the contract
  // In production, backend should cache this
  const response = await apiClient.get<{ success: boolean; data: { nonce: number }; error?: string }>(
    `/intent/nonce?address=${address}`
  )
  
  if (!response.success) {
    // Default to 0 if endpoint doesn't exist yet
    return 0
  }
  
  return response.data.nonce
}
