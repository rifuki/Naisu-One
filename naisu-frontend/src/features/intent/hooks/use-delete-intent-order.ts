import { queryKeys } from '@/lib/query-keys'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { deleteIntentOrder } from '../api/delete-intent-order'

export function useDeleteIntentOrder() {
  const queryClient = useQueryClient()
  
  return useMutation<void, Error, string>({
    mutationFn: deleteIntentOrder,
    onSuccess: () => {
      // Invalidate intent orders query after deletion
      queryClient.invalidateQueries({ queryKey: queryKeys.intent.orders() })
    },
  })
}
