import { useQuery } from '@tanstack/react-query';
import { AdminAPI, HealthResponse, AdminAPIError } from '@/services/adminApi';

const HEALTH_QUERY_KEY = 'health';

interface UseHealthOptions {
  refetchInterval?: number;
  enabled?: boolean;
}

/**
 * Hook for checking service health
 * Uses GET /health
 */
export function useHealth(options: UseHealthOptions = {}) {
  return useQuery<HealthResponse, AdminAPIError>({
    queryKey: [HEALTH_QUERY_KEY],
    queryFn: () => AdminAPI.health(),
    refetchInterval: options.refetchInterval || 30000, // Default: refresh every 30 seconds
    enabled: options.enabled !== false,
  });
}

export default useHealth;
