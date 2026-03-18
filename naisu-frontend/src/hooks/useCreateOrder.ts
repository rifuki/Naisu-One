import { useState } from 'react';
import { useWalletClient, useAccount } from 'wagmi';

const API = ((import.meta.env.VITE_API_URL as string | undefined)?.trim()) || 'http://localhost:3000/api/v1';

interface CreateOrderParams {
  evmAddress: string;
  solanaAddress: string;
  amount: string;
  outputToken: 'sol' | 'msol' | 'marginfi';
}

interface BuiltTx {
  to: string;
  data: string;
  value: string;
  chainId: number;
}

export function useCreateOrder() {
  const { data: walletClient } = useWalletClient();
  const { address } = useAccount();
  const [isBuilding, setIsBuilding] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async ({ evmAddress, solanaAddress, amount, outputToken }: CreateOrderParams): Promise<string> => {
    if (!walletClient) throw new Error('No EVM wallet connected');
    setError(null);
    setTxHash(null);

    // Step 1: Build tx
    setIsBuilding(true);
    let tx: BuiltTx;
    try {
      const res = await fetch(`${API}/intent/build-tx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chain: 'evm-base',
          action: 'create_order',
          senderAddress: evmAddress,
          recipientAddress: solanaAddress,
          destinationChain: 'solana',
          amount,
          outputToken,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        const msg = json.error ?? 'Build failed';
        setError(msg);
        throw new Error(msg);
      }
      tx = json.data.tx;
    } finally {
      setIsBuilding(false);
    }

    // Step 2: Sign & send
    setIsSigning(true);
    try {
      const hash = await walletClient.sendTransaction({
        account: address!,
        to: tx.to as `0x${string}`,
        data: tx.data as `0x${string}`,
        value: BigInt(tx.value),
        chainId: tx.chainId,
      } as any);
      setTxHash(hash);
      return hash;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Transaction rejected';
      setError(msg);
      throw e;
    } finally {
      setIsSigning(false);
    }
  };

  return {
    submit,
    isBuilding,
    isSigning,
    isBusy: isBuilding || isSigning,
    txHash,
    error,
    clearError: () => setError(null),
  };
}
