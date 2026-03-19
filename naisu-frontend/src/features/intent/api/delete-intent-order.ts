import { apiClient } from '@/lib/api-client'

export async function deleteIntentOrder(orderId: string): Promise<void> {
  const response = await apiClient.delete<{ success: boolean; error?: string }>(`/intent/orders/${orderId}`)
  
  if (!response.success) {
    throw new Error(response.error || 'Failed to delete order')
  }
}
