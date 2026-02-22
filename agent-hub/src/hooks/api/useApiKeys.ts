import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AdminAPI,
  ApiKey,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  AdminAPIError,
} from '@/services/adminApi';

const API_KEYS_QUERY_KEY = 'api-keys';

interface UseApiKeysOptions {
  enabled?: boolean;
}

/**
 * Hook for listing API keys
 * Uses GET /v1/keys
 */
export function useApiKeys(options: UseApiKeysOptions = {}) {
  return useQuery<ApiKey[], AdminAPIError>({
    queryKey: [API_KEYS_QUERY_KEY],
    queryFn: async () => {
      const response = await AdminAPI.listApiKeys();
      return response.keys;
    },
    enabled: options.enabled !== false,
  });
}

interface UseCreateApiKeyOptions {
  onSuccess?: (data: CreateApiKeyResponse) => void;
  onError?: (error: AdminAPIError) => void;
}

/**
 * Hook for creating a new API key
 * Uses POST /v1/keys
 */
export function useCreateApiKey(options: UseCreateApiKeyOptions = {}) {
  const queryClient = useQueryClient();

  return useMutation<CreateApiKeyResponse, AdminAPIError, CreateApiKeyRequest>({
    mutationFn: (request) => AdminAPI.createApiKey(request),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [API_KEYS_QUERY_KEY] });
      options.onSuccess?.(data);
    },
    onError: options.onError,
  });
}

interface UseRevokeApiKeyOptions {
  onSuccess?: () => void;
  onError?: (error: AdminAPIError) => void;
}

/**
 * Hook for revoking an API key
 * Uses POST /v1/keys/:id/revoke
 */
export function useRevokeApiKey(options: UseRevokeApiKeyOptions = {}) {
  const queryClient = useQueryClient();

  return useMutation<{ ok: true; message: string }, AdminAPIError, string>({
    mutationFn: (keyId) => AdminAPI.revokeApiKey(keyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [API_KEYS_QUERY_KEY] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

interface UseActivateApiKeyOptions {
  onSuccess?: () => void;
  onError?: (error: AdminAPIError) => void;
}

/**
 * Hook for activating a revoked API key
 * Uses POST /v1/keys/:id/activate
 */
export function useActivateApiKey(options: UseActivateApiKeyOptions = {}) {
  const queryClient = useQueryClient();

  return useMutation<{ ok: true; message: string }, AdminAPIError, string>({
    mutationFn: (keyId) => AdminAPI.activateApiKey(keyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [API_KEYS_QUERY_KEY] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

interface UseDeleteApiKeyOptions {
  onSuccess?: () => void;
  onError?: (error: AdminAPIError) => void;
}

/**
 * Hook for deleting an API key permanently
 * Uses DELETE /v1/keys/:id
 */
export function useDeleteApiKey(options: UseDeleteApiKeyOptions = {}) {
  const queryClient = useQueryClient();

  return useMutation<{ ok: true; message: string }, AdminAPIError, string>({
    mutationFn: (keyId) => AdminAPI.deleteApiKey(keyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [API_KEYS_QUERY_KEY] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

export default useApiKeys;
