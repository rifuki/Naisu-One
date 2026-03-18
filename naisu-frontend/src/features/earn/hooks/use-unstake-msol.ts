import { useMutation } from '@tanstack/react-query';
import { buildUnstakeMsolTx } from '../api/get-portfolio-balances';

export function useUnstakeMsol() {
  return useMutation<string, Error, { wallet: string; amount: string }>({
    mutationFn: ({ wallet, amount }) => buildUnstakeMsolTx(wallet, amount),
  });
}
