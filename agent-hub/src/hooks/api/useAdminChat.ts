import { useMutation } from '@tanstack/react-query';
import { AdminAPI, ChatRequest, ChatResponse, AdminAPIError } from '@/services/adminApi';

interface UseAdminChatOptions {
  onSuccess?: (data: ChatResponse) => void;
  onError?: (error: AdminAPIError) => void;
}

/**
 * Hook for admin chat (unlimited)
 * Uses POST /v1/admin/chat
 */
export function useAdminChat(options: UseAdminChatOptions = {}) {
  return useMutation<ChatResponse, AdminAPIError, ChatRequest>({
    mutationFn: (request) => AdminAPI.sendChat(request),
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
}

export default useAdminChat;
