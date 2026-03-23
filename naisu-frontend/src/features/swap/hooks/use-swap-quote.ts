import { queryKeys } from '@/lib/query-keys'
import { useQuery } from '@tanstack/react-query';
import { getIntentQuote, type GetIntentQuoteParams, type IntentQuote } from '@/features/intent/api/get-intent-quote';

const STALE_TIME = 5 * 1000; // 5 seconds
const REFETCH_INTERVAL = 5 * 1000; // 5 seconds

export interface SwapQuoteParams {
  amount: string;
  fromChain?: string;
  toChain?: string;
  token?: string;
}

export function useSwapQuote(params: SwapQuoteParams) {
  const { amount, fromChain = 'evm-base', toChain = 'solana', token = 'native' } = params;

  return useQuery<IntentQuote, Error>({
    queryKey: queryKeys.swap.quote(params),
    queryFn: () => getIntentQuote({ amount, fromChain, toChain, token }),
    enabled: !!amount && parseFloat(amount) > 0,
    staleTime: STALE_TIME,
    refetchInterval: REFETCH_INTERVAL,
  });
}
