import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createIntentOrder, type CreateIntentOrderParams, type CreateIntentOrderResponse } from '@/features/intent/api/create-intent-order';

export interface SwapOrderParams {
  evmAddress: string;
  solanaAddress: string;
  amount: string;
  outputToken: 'sol' | 'msol' | 'jito' | 'jupsol' | 'kamino';
}

export function useSwapOrder() {
  const queryClient = useQueryClient();

  return useMutation<CreateIntentOrderResponse, Error, SwapOrderParams>({
    mutationFn: (params) =>
      createIntentOrder({
        senderAddress: params.evmAddress,
        recipientAddress: params.solanaAddress,
        destinationChain: 'solana',
        amount: params.amount,
        outputToken: params.outputToken,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['intent', 'orders'] });
    },
  });
}
