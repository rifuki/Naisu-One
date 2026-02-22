import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AdminAPI,
  BuiltinTool,
  CustomTool,
  CreateToolRequest,
  CreateToolResponse,
  UpdateToolRequest,
  UpdateToolResponse,
  AdminAPIError,
} from '@/services/adminApi';

const TOOLS_QUERY_KEY = 'tools';

export interface ToolsData {
  builtin: BuiltinTool[];
  custom: CustomTool[];
}

interface UseToolsOptions {
  enabled?: boolean;
}

/**
 * Hook for listing all tools (built-in + custom)
 * Uses GET /v1/admin/tools
 */
export function useTools(options: UseToolsOptions = {}) {
  return useQuery<ToolsData, AdminAPIError>({
    queryKey: [TOOLS_QUERY_KEY],
    queryFn: async () => {
      const response = await AdminAPI.listTools();
      return response.tools;
    },
    enabled: options.enabled !== false,
  });
}

interface UseToolOptions {
  enabled?: boolean;
}

/**
 * Hook for getting a specific tool details
 * Uses GET /v1/admin/tools/:id
 */
export function useTool(toolId: string | null, options: UseToolOptions = {}) {
  return useQuery<CustomTool, AdminAPIError>({
    queryKey: [TOOLS_QUERY_KEY, toolId],
    queryFn: async () => {
      if (!toolId) throw new Error('Tool ID is required');
      const response = await AdminAPI.getTool(toolId);
      return response.tool;
    },
    enabled: !!toolId && options.enabled !== false,
  });
}

interface UseCreateToolOptions {
  onSuccess?: (data: CreateToolResponse) => void;
  onError?: (error: AdminAPIError) => void;
}

/**
 * Hook for creating a new custom tool
 * Uses POST /v1/admin/tools
 */
export function useCreateTool(options: UseCreateToolOptions = {}) {
  const queryClient = useQueryClient();

  return useMutation<CreateToolResponse, AdminAPIError, CreateToolRequest>({
    mutationFn: (request) => AdminAPI.createTool(request),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [TOOLS_QUERY_KEY] });
      options.onSuccess?.(data);
    },
    onError: options.onError,
  });
}

interface UseUpdateToolOptions {
  onSuccess?: (data: UpdateToolResponse) => void;
  onError?: (error: AdminAPIError) => void;
}

/**
 * Hook for updating an existing custom tool
 * Uses PUT /v1/admin/tools/:id
 */
export function useUpdateTool(options: UseUpdateToolOptions = {}) {
  const queryClient = useQueryClient();

  return useMutation<
    UpdateToolResponse,
    AdminAPIError,
    { toolId: string; request: UpdateToolRequest }
  >({
    mutationFn: ({ toolId, request }) => AdminAPI.updateTool(toolId, request),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [TOOLS_QUERY_KEY] });
      options.onSuccess?.(data);
    },
    onError: options.onError,
  });
}

interface UseDeleteToolOptions {
  onSuccess?: () => void;
  onError?: (error: AdminAPIError) => void;
}

/**
 * Hook for deleting a custom tool permanently
 * Uses DELETE /v1/admin/tools/:id
 */
export function useDeleteTool(options: UseDeleteToolOptions = {}) {
  const queryClient = useQueryClient();

  return useMutation<{ ok: true; message: string }, AdminAPIError, string>({
    mutationFn: (toolId) => AdminAPI.deleteTool(toolId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [TOOLS_QUERY_KEY] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

/**
 * Hook for toggling tool active status
 * Uses PUT /v1/admin/tools/:id
 */
export function useToggleToolStatus(options: UseUpdateToolOptions = {}) {
  const queryClient = useQueryClient();

  return useMutation<
    UpdateToolResponse,
    AdminAPIError,
    { toolId: string; isActive: boolean }
  >({
    mutationFn: ({ toolId, isActive }) =>
      AdminAPI.updateTool(toolId, { isActive }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [TOOLS_QUERY_KEY] });
      options.onSuccess?.(data);
    },
    onError: options.onError,
  });
}

export default useTools;
