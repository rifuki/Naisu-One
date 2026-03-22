import { queryKeys } from '@/lib/query-keys'
import { useQuery } from '@tanstack/react-query'
import { getIntentOrders, type GetIntentOrdersParams, type IntentOrder } from '../api/get-intent-orders'

const STALE_TIME = 12 * 1000 // 12 seconds
const REFETCH_INTERVAL = 12 * 1000 // 12 seconds

export function useIntentOrders(params: GetIntentOrdersParams) {
  return useQuery<IntentOrder[], Error>({
    queryKey: queryKeys.intent.ordersByParams(params),
    queryFn: () => getIntentOrders(params),
    enabled: !!params.user,
    staleTime: STALE_TIME,
    refetchInterval: REFETCH_INTERVAL,
  })
}
