import { queryKeys } from '@/lib/query-keys'
import { useQuery } from '@tanstack/react-query'
import { getIntentQuote, type GetIntentQuoteParams, type IntentQuote } from '../api/get-intent-quote'

const STALE_TIME = 30 * 1000 // 30 seconds
const REFETCH_INTERVAL = 30 * 1000 // 30 seconds

export function useIntentQuote(params: GetIntentQuoteParams) {
  const { amount } = params
  
  return useQuery<IntentQuote, Error>({
    queryKey: queryKeys.intent.quote(params),
    queryFn: () => getIntentQuote(params),
    enabled: !!amount && parseFloat(amount) > 0,
    staleTime: STALE_TIME,
    refetchInterval: REFETCH_INTERVAL,
  })
}
