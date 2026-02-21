import { useReadContract } from 'wagmi';
import { formatUnits } from 'viem';

const erc20BalanceAbi = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

export function useTokenBalance(
  tokenAddress: `0x${string}` | undefined,
  userAddress: `0x${string}` | undefined,
  decimals: number
) {
  const { data: balanceRaw, isLoading, error, refetch } = useReadContract({
    address: tokenAddress,
    abi: erc20BalanceAbi,
    functionName: 'balanceOf',
    args: userAddress ? [userAddress] : undefined,
  });

  const formatted =
    balanceRaw !== undefined && balanceRaw !== null
      ? formatUnits(balanceRaw, decimals)
      : undefined;

  return {
    balance: balanceRaw ?? 0n,
    formatted,
    isLoading,
    error,
    refetch,
  };
}
