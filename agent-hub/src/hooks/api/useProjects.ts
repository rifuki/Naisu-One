import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AdminAPI,
  Project,
  CreateProjectRequest,
  CreateProjectResponse,
  UpdateProjectRequest,
  UpdateProjectResponse,
  AdminAPIError,
} from '@/services/adminApi';

const PROJECTS_QUERY_KEY = 'projects';

interface UseProjectsOptions {
  enabled?: boolean;
}

/**
 * Hook for listing all projects
 * Uses GET /v1/admin/projects
 */
export function useProjects(options: UseProjectsOptions = {}) {
  return useQuery<Project[], AdminAPIError>({
    queryKey: [PROJECTS_QUERY_KEY],
    queryFn: async () => {
      const response = await AdminAPI.listProjects();
      return response.projects;
    },
    enabled: options.enabled !== false,
  });
}

interface UseProjectOptions {
  enabled?: boolean;
}

/**
 * Hook for getting a specific project
 * Uses GET /v1/admin/projects/:id
 */
export function useProject(projectId: string | null, options: UseProjectOptions = {}) {
  return useQuery<Project, AdminAPIError>({
    queryKey: [PROJECTS_QUERY_KEY, projectId],
    queryFn: async () => {
      if (!projectId) throw new Error('Project ID is required');
      const response = await AdminAPI.getProject(projectId);
      return response.project;
    },
    enabled: !!projectId && options.enabled !== false,
  });
}

/**
 * Hook for getting project character
 * Uses GET /v1/admin/projects/:id/character
 */
export function useProjectCharacter(projectId: string | null, options: UseProjectOptions = {}) {
  return useQuery<string, AdminAPIError>({
    queryKey: [PROJECTS_QUERY_KEY, projectId, 'character'],
    queryFn: async () => {
      if (!projectId) throw new Error('Project ID is required');
      const response = await AdminAPI.getProjectCharacter(projectId);
      return response.character;
    },
    enabled: !!projectId && options.enabled !== false,
  });
}

interface UseCreateProjectOptions {
  onSuccess?: (data: CreateProjectResponse) => void;
  onError?: (error: AdminAPIError) => void;
}

/**
 * Hook for creating a new project
 * Uses POST /v1/admin/projects
 */
export function useCreateProject(options: UseCreateProjectOptions = {}) {
  const queryClient = useQueryClient();

  return useMutation<CreateProjectResponse, AdminAPIError, CreateProjectRequest>({
    mutationFn: (request) => AdminAPI.createProject(request),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [PROJECTS_QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: ['api-keys'] }); // Projects create API keys
      options.onSuccess?.(data);
    },
    onError: options.onError,
  });
}

interface UseUpdateProjectOptions {
  onSuccess?: (data: UpdateProjectResponse) => void;
  onError?: (error: AdminAPIError) => void;
}

/**
 * Hook for updating an existing project
 * Uses PUT /v1/admin/projects/:id
 */
export function useUpdateProject(options: UseUpdateProjectOptions = {}) {
  const queryClient = useQueryClient();

  return useMutation<
    UpdateProjectResponse,
    AdminAPIError,
    { projectId: string; request: UpdateProjectRequest }
  >({
    mutationFn: ({ projectId, request }) => AdminAPI.updateProject(projectId, request),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [PROJECTS_QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: [PROJECTS_QUERY_KEY, data.project.id] });
      options.onSuccess?.(data);
    },
    onError: options.onError,
  });
}

interface UseDeleteProjectOptions {
  onSuccess?: () => void;
  onError?: (error: AdminAPIError) => void;
}

/**
 * Hook for deleting a project permanently
 * Uses DELETE /v1/admin/projects/:id
 */
export function useDeleteProject(options: UseDeleteProjectOptions = {}) {
  const queryClient = useQueryClient();

  return useMutation<{ ok: true; message: string }, AdminAPIError, string>({
    mutationFn: (projectId) => AdminAPI.deleteProject(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [PROJECTS_QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: ['api-keys'] }); // Projects delete API keys
      options.onSuccess?.();
    },
    onError: options.onError,
  });
}

/**
 * Hook for toggling project active status
 * Uses PUT /v1/admin/projects/:id
 */
export function useToggleProjectStatus(options: UseUpdateProjectOptions = {}) {
  const queryClient = useQueryClient();

  return useMutation<
    UpdateProjectResponse,
    AdminAPIError,
    { projectId: string; isActive: boolean }
  >({
    mutationFn: ({ projectId, isActive }) =>
      AdminAPI.updateProject(projectId, { isActive }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [PROJECTS_QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: [PROJECTS_QUERY_KEY, data.project.id] });
      options.onSuccess?.(data);
    },
    onError: options.onError,
  });
}

export default useProjects;
