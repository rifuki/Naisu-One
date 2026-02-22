import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AdminAPI,
  Agent,
  AgentRoleInfo,
  CreateAgentRequest,
  CreateAgentResponse,
  UpdateAgentRequest,
  UpdateAgentResponse,
  AdminAPIError,
} from '@/services/adminApi';

const AGENTS_QUERY_KEY = 'agents';
const AGENT_ROLES_QUERY_KEY = 'agent-roles';

interface UseAgentsOptions {
  projectId?: string;
  enabled?: boolean;
}

/**
 * Hook for listing all agents (optionally filtered by project)
 * Uses GET /v1/admin/agents
 */
export function useAgents(options: UseAgentsOptions = {}) {
  return useQuery<Agent[], AdminAPIError>({
    queryKey: [AGENTS_QUERY_KEY, options.projectId],
    queryFn: async () => {
      const response = await AdminAPI.listAgents(options.projectId);
      return response.agents;
    },
    enabled: options.enabled !== false,
  });
}

interface UseAgentOptions {
  enabled?: boolean;
}

/**
 * Hook for getting a specific agent
 * Uses GET /v1/admin/agents/:id
 */
export function useAgent(agentId: string | null, options: UseAgentOptions = {}) {
  return useQuery<Agent, AdminAPIError>({
    queryKey: [AGENTS_QUERY_KEY, agentId],
    queryFn: async () => {
      if (!agentId) throw new Error('Agent ID is required');
      const response = await AdminAPI.getAgent(agentId);
      return response.agent;
    },
    enabled: !!agentId && options.enabled !== false,
  });
}

/**
 * Hook for getting available agent roles
 * Uses GET /v1/admin/agents/roles
 */
export function useAgentRoles(options: { enabled?: boolean } = {}) {
  return useQuery<AgentRoleInfo[], AdminAPIError>({
    queryKey: [AGENT_ROLES_QUERY_KEY],
    queryFn: async () => {
      const response = await AdminAPI.getAgentRoles();
      return response.roles;
    },
    enabled: options.enabled !== false,
  });
}

interface UseCreateAgentOptions {
  onSuccess?: (data: CreateAgentResponse) => void;
  onError?: (error: AdminAPIError) => void;
}

/**
 * Hook for creating a new agent
 * Uses POST /v1/admin/agents
 */
export function useCreateAgent(options: UseCreateAgentOptions = {}) {
  const queryClient = useQueryClient();

  return useMutation<CreateAgentResponse, AdminAPIError, CreateAgentRequest>({
    mutationFn: (request) => AdminAPI.createAgent(request),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [AGENTS_QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: [AGENTS_QUERY_KEY, data.agent.projectId] });
      options.onSuccess?.(data);
    },
    onError: options.onError,
  });
}

interface UseUpdateAgentOptions {
  onSuccess?: (data: UpdateAgentResponse) => void;
  onError?: (error: AdminAPIError) => void;
}

/**
 * Hook for updating an existing agent
 * Uses PUT /v1/admin/agents/:id
 */
export function useUpdateAgent(options: UseUpdateAgentOptions = {}) {
  const queryClient = useQueryClient();

  return useMutation<
    UpdateAgentResponse,
    AdminAPIError,
    { agentId: string; request: UpdateAgentRequest }
  >({
    mutationFn: ({ agentId, request }) => AdminAPI.updateAgent(agentId, request),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [AGENTS_QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: [AGENTS_QUERY_KEY, data.agent.id] });
      queryClient.invalidateQueries({ queryKey: [AGENTS_QUERY_KEY, data.agent.projectId] });
      options.onSuccess?.(data);
    },
    onError: options.onError,
  });
}

interface UseDeleteAgentOptions {
  onSuccess?: () => void;
  onError?: (error: AdminAPIError) => void;
}

/**
 * Hook for deleting an agent permanently
 * Uses DELETE /v1/admin/agents/:id
 */
export function useDeleteAgent(options: UseDeleteAgentOptions = {}) {
  const queryClient = useQueryClient();

  return useMutation<{ ok: true; message: string }, AdminAPIError, string>({
    mutationFn: (agentId) => AdminAPI.deleteAgent(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [AGENTS_QUERY_KEY] });
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

/**
 * Hook for toggling agent active status
 * Uses PUT /v1/admin/agents/:id
 */
export function useToggleAgentStatus(options: UseUpdateAgentOptions = {}) {
  const queryClient = useQueryClient();

  return useMutation<
    UpdateAgentResponse,
    AdminAPIError,
    { agentId: string; isActive: boolean }
  >({
    mutationFn: ({ agentId, isActive }) =>
      AdminAPI.updateAgent(agentId, { isActive }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [AGENTS_QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: [AGENTS_QUERY_KEY, data.agent.id] });
      options.onSuccess?.(data);
    },
    onError: options.onError,
  });
}

export default useAgents;
