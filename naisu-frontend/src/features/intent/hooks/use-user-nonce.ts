import { useQuery } from '@tanstack/react-query';
import { API_URL } from '@/lib/env'

interface NonceResponse {
  success: boolean;
  data: {
    address: string;
    nonce: number;
    message: string;
  };
}

/**
 * Fetch the expected nonce for a user's next gasless intent
 */
async function fetchUserNonce(address: string): Promise<number> {
  const res = await fetch(`${API_URL}/intent/nonce?address=${address}`);
  if (!res.ok) {
    throw new Error('Failed to fetch nonce');
  }
  const data: NonceResponse = await res.json();
  return data.data.nonce;
}

/**
 * Hook to get the user's current nonce for gasless intents
 */
export function useUserNonce(address: string | undefined) {
  return useQuery({
    queryKey: ['intent', 'nonce', address],
    queryFn: () => fetchUserNonce(address!),
    enabled: !!address,
    staleTime: 5000, // Refetch every 5 seconds if stale
    refetchOnWindowFocus: true,
  });
}
