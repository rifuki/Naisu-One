/**
 * Build swap tx on backend, then user signs and sends.
 * Uses POST /api/v1/uniswap-v4/swap/build and walletClient.sendTransaction.
 */
import { useCallback, useState } from 'react';
import { useWalletClient, usePublicClient } from 'wagmi';

function resolveApiBase() {
  const configured = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  const fallback = import.meta.env.DEV
    ? 'http://localhost:3000/api/v1'
    : 'https://dev-api.naisu.one/api/v1';
  const base = (configured && configured.length > 0 ? configured : fallback).replace(/\/$/, '');

  // Prevent mixed-content failures when site is served over HTTPS.
  if (typeof window !== 'undefined' && window.location.protocol === 'https:' && base.startsWith('http://')) {
    return `https://${base.slice('http://'.length)}`;
  }
  return base;
}

const API_BASE = resolveApiBase();

export interface BuildTxItem {
  to: string;
  data: string;
  value: string;
  chainId: number;
  description: string;
}

export interface SwapBuildResponse {
  success: true;
  data: {
    transactions: BuildTxItem[];
    summary: {
      tokenIn: string;
      tokenOut: string;
      amountIn: string;
      minAmountOut: string;
      deadline: string;
      swapContract: string;
      needsApproval: boolean;
    };
  };
}

export interface BuildParams {
  sender: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  minAmountOut?: string;
  deadlineSeconds?: number;
}

export function useSwapBuild() {
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [isBuilding, setIsBuilding] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHashes, setTxHashes] = useState<string[]>([]);

  const executeTransactions = useCallback(
    async (buildResponse: SwapBuildResponse): Promise<string[]> => {
      const txs = buildResponse.data.transactions;
      if (!txs.length) throw new Error('No transactions to sign');
      if (!walletClient) throw new Error('Wallet not connected');
      if (!publicClient) throw new Error('Public client not available');

      setIsSigning(true);
      setError(null);
      const hashes: string[] = [];

      try {
        for (let i = 0; i < txs.length; i++) {
          const tx = txs[i];
          console.log(`[Swap] Sending tx ${i + 1}/${txs.length}:`, tx.description);
          
          const hash = await walletClient.sendTransaction({
            to: tx.to as `0x${string}`,
            data: tx.data as `0x${string}`,
            value: BigInt(tx.value),
            chainId: tx.chainId,
          });
          
          hashes.push(hash);
          setTxHashes([...hashes]);
          console.log(`[Swap] Tx ${i + 1} hash:`, hash);

          // Wait for receipt before next tx (important for approval → swap flow)
          if (i < txs.length - 1) {
            console.log(`[Swap] Waiting for tx ${i + 1} confirmation...`);
            await publicClient.waitForTransactionReceipt({ hash });
            console.log(`[Swap] Tx ${i + 1} confirmed`);
          }
        }
        
        // Wait for final transaction
        if (hashes.length > 0) {
          console.log('[Swap] Waiting for final tx confirmation...');
          await publicClient.waitForTransactionReceipt({ hash: hashes[hashes.length - 1] });
          console.log('[Swap] All transactions confirmed');
        }
        
        return hashes;
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Transaction failed';
        console.error('[Swap] Execution failed:', msg);
        setError(msg);
        throw e;
      } finally {
        setIsSigning(false);
      }
    },
    [walletClient, publicClient]
  );

  const buildAndSign = useCallback(
    async (params: BuildParams): Promise<string[]> => {
      setIsBuilding(true);
      setError(null);
      setTxHashes([]);
      
      try {
        console.log('[Swap] Building transaction...', params);
        
        const res = await fetch(`${API_BASE}/uniswap-v4/swap/build`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sender: params.sender,
            tokenIn: params.tokenIn,
            tokenOut: params.tokenOut,
            amountIn: params.amountIn,
            minAmountOut: params.minAmountOut ?? '0',
            deadlineSeconds: params.deadlineSeconds ?? 3600,
          }),
        });
        
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error?.message ?? `Build failed: ${res.status}`);
        }
        
        const json: SwapBuildResponse = await res.json();
        console.log('[Swap] Build response:', json);
        
        if (!json.success || !json.data?.transactions?.length) {
          throw new Error('Invalid build response - no transactions to execute');
        }
        
        // Move to signing/execution phase
        setIsBuilding(false);
        return executeTransactions(json);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Build failed';
        console.error('[Swap] Build failed:', msg);
        setError(msg);
        throw e;
      } finally {
        setIsBuilding(false);
      }
    },
    [executeTransactions]
  );

  return {
    buildAndSign,
    executeTransactions,
    isBuilding,
    isSigning,
    isBusy: isBuilding || isSigning,
    error,
    txHashes,
    clearError: () => setError(null),
  };
}
