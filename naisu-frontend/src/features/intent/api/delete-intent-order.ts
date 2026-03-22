import { apiClient } from '@/lib/api/client'

export async function deleteIntentOrder(orderId: string): Promise<void> {
  await apiClient.delete(`/intent/orders/${orderId}`)
}
