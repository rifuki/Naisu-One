import { queryKeys } from '@/lib/query-keys'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createIntentOrder, type CreateIntentOrderParams, type CreateIntentOrderResponse } from '../api/create-intent-order'

export function useCreateIntentOrder() {
  const queryClient = useQueryClient()
  
  return useMutation<CreateIntentOrderResponse, Error, CreateIntentOrderParams>({
    mutationFn: createIntentOrder,
    onSuccess: () => {
      // Invalidate intent orders query after creating new order
      queryClient.invalidateQueries({ queryKey: queryKeys.intent.orders() })
    },
  })
}
