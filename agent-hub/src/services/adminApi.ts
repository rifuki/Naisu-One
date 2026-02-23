/**
 * Admin API Service for Agent Infra LangChain TS
 * 
 * This service provides methods to interact with admin endpoints.
 * All admin endpoints require the master API key.
 */

// Types
export interface ChatRequest {
  userId: string;
  sessionId?: string;
  message: string;
}

export interface ChatResponse {
  ok: true;
  sessionId: string;
  message: string;
}

export interface ApiKey {
  id: string;
  keyPrefix: string;
  name: string;
  description?: string;
  permissions: string[];
  createdAt: string;
  expiresAt?: string;
  isActive: boolean;
}

export interface CreateApiKeyRequest {
  name: string;
  description?: string;
  permissions?: string[];
  expiresInDays?: number;
}

export interface CreateApiKeyResponse {
  ok: true;
  key: string;
  apiKey: ApiKey;
}

export interface ListApiKeysResponse {
  ok: true;
  keys: ApiKey[];
}

export interface RAGIngestRequest {
  tenantId: string;
  source: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface RAGIngestResponse {
  ok: true;
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface RAGUploadResponse {
  ok: true;
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  parsed?: {
    filename: string;
    type: string;
    size: number;
    wordCount: number;
    pages?: number;
  };
}

// ====================
// Projects Types
// ====================

export interface Project {
  id: string;
  name: string;
  apiKeyId: string;
  keyPrefix: string;
  description?: string;
  character?: string;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
  character?: string;
}

export interface CreateProjectResponse {
  ok: true;
  project: Project;
  apiKey: string;
}

export interface ListProjectsResponse {
  ok: true;
  projects: Project[];
}

export interface GetProjectResponse {
  ok: true;
  project: Project;
}

export interface GetProjectCharacterResponse {
  ok: true;
  character: string;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string;
  character?: string;
  isActive?: boolean;
}

export interface UpdateProjectResponse {
  ok: true;
  project: Project;
}

export interface DeleteProjectResponse {
  ok: true;
  message: string;
}

// ====================
// Agents Types
// ====================

export type AgentRole = 
  | "custom"
  | "defi_expert" 
  | "support" 
  | "teacher" 
  | "analyst" 
  | "creative"
  | "coder"
  | "sales";

export interface Agent {
  id: string;
  name: string;
  description?: string;
  projectId: string;
  role: AgentRole;
  character?: string;
  model?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRoleInfo {
  id: AgentRole;
  name: string;
  description: string;
}

export interface CreateAgentRequest {
  name: string;
  description?: string;
  projectId: string;
  role?: AgentRole;
  character?: string;
  model?: string;
}

export interface CreateAgentResponse {
  ok: true;
  agent: Agent;
}

export interface ListAgentsResponse {
  ok: true;
  agents: Agent[];
}

export interface GetAgentResponse {
  ok: true;
  agent: Agent;
}

export interface GetAgentRolesResponse {
  ok: true;
  roles: AgentRoleInfo[];
}

export interface UpdateAgentRequest {
  name?: string;
  description?: string;
  role?: AgentRole;
  character?: string;
  model?: string;
  isActive?: boolean;
}

export interface UpdateAgentResponse {
  ok: true;
  agent: Agent;
}

export interface DeleteAgentResponse {
  ok: true;
  message: string;
}

export interface RAGJob {
  id: string;
  tenantId: string;
  source: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  chunks?: number;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

export interface RAGJobResponse {
  ok: true;
  job: RAGJob;
}

export interface RAGSearchResult {
  id: string;
  content: string;
  source: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface RAGSearchResponse {
  ok: true;
  items: RAGSearchResult[];
}

export interface HealthResponse {
  ok: boolean;
  service: string;
  llmProvider: string;
  oauthEnabled: boolean;
  apiKeyRequired: boolean;
  apiKeyConfigured: boolean;
  managedKeys: number;
  rateLimitingEnabled: boolean;
  rateLimitConfig?: {
    maxRequests: number;
    windowSeconds: number;
  };
}

// ====================
// Tools Types
// ====================

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required: boolean;
  default?: unknown;
}

export interface ToolExecutionHTTP {
  type: 'http';
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  bodyTemplate?: string;
  timeoutMs?: number;
}

export interface ToolExecutionCode {
  type: 'code';
  code: string;
}

export type ToolExecution = ToolExecutionHTTP | ToolExecutionCode;

export interface BuiltinTool {
  name: string;
  description: string;
  schema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface CustomTool {
  id: string;
  name: string;
  description: string;
  parameters: ToolParameter[];
  execution: ToolExecution;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListToolsResponse {
  ok: true;
  tools: {
    builtin: BuiltinTool[];
    custom: CustomTool[];
  };
}

export interface GetToolResponse {
  ok: true;
  tool: CustomTool;
}

export interface CreateToolRequest {
  name: string;
  description: string;
  parameters: ToolParameter[];
  execution: ToolExecution;
}

export interface CreateToolResponse {
  ok: true;
  tool: CustomTool;
}

export interface UpdateToolRequest {
  name?: string;
  description?: string;
  parameters?: ToolParameter[];
  execution?: ToolExecution;
  isActive?: boolean;
}

export interface UpdateToolResponse {
  ok: true;
  tool: CustomTool;
}

export interface DeleteToolResponse {
  ok: true;
  message: string;
}

export interface ApiError {
  ok: false;
  error: string;
  message?: string;
  details?: unknown;
}

// Configuration
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787';
const MASTER_API_KEY = ''; // moved server-side via proxy

// Custom error class for API errors
export class AdminAPIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public response?: ApiError
  ) {
    super(message);
    this.name = 'AdminAPIError';
  }
}

// Helper function to get headers with authorization
function getHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
  };
}

function proxyUrl(path: string): string {
  return `/api/admin-proxy?path=${encodeURIComponent(path)}`;
}

async function fetchAdmin(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  if (init.body instanceof FormData) {
    headers.delete('Content-Type');
  }
  return fetch(proxyUrl(path), { ...init, headers });
}

// Helper function to handle API responses
async function handleResponse<T>(response: Response): Promise<T> {
  const data = await response.json();
  
  if (!response.ok || !data.ok) {
    const errorData = data as ApiError;
    throw new AdminAPIError(
      errorData.error || `HTTP ${response.status}: ${response.statusText}`,
      response.status,
      errorData
    );
  }
  
  return data as T;
}

/**
 * Admin API Service
 * 
 * Provides methods to interact with admin endpoints.
 * Requires VITE_MASTER_API_KEY to be set in environment variables.
 */
export const AdminAPI = {
  /**
   * Check if API key is configured
   */
  isConfigured(): boolean {
    return true;
  },

  /**
   * Get the API base URL
   */
  getBaseUrl(): string {
    return API_BASE_URL;
  },

  /**
   * Get the configured master API key (masked)
   */
  getKeyPreview(): string {
    return 'Stored server-side';
  },

  // ====================
  // Health Check
  // ====================
  
  /**
   * Check service health
   */
  async health(): Promise<HealthResponse> {
    const response = await fetchAdmin('/health');
    return handleResponse<HealthResponse>(response);
  },

  // ====================
  // Admin Chat
  // ====================
  
  /**
   * Send a chat message (admin - unlimited)
   * Requires master API key
   */
  async sendChat(request: ChatRequest): Promise<ChatResponse> {
    const response = await fetchAdmin('/v1/admin/chat', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(request),
    });
    return handleResponse<ChatResponse>(response);
  },

  // ====================
  // API Key Management
  // ====================
  
  /**
   * List all managed API keys
   * Requires master API key
   */
  async listApiKeys(): Promise<ListApiKeysResponse> {
    const response = await fetchAdmin('/v1/keys', {
      headers: {},
    });
    return handleResponse<ListApiKeysResponse>(response);
  },

  /**
   * Create a new API key
   * Requires master API key
   */
  async createApiKey(request: CreateApiKeyRequest): Promise<CreateApiKeyResponse> {
    const response = await fetchAdmin('/v1/keys', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(request),
    });
    return handleResponse<CreateApiKeyResponse>(response);
  },

  /**
   * Revoke an API key (deactivate)
   * Requires master API key
   */
  async revokeApiKey(keyId: string): Promise<{ ok: true; message: string }> {
    const response = await fetchAdmin(`/v1/keys/${keyId}/revoke`, {
      method: 'POST',
      headers: {},
    });
    return handleResponse<{ ok: true; message: string }>(response);
  },

  /**
   * Activate a revoked API key
   * Requires master API key
   */
  async activateApiKey(keyId: string): Promise<{ ok: true; message: string }> {
    const response = await fetchAdmin(`/v1/keys/${keyId}/activate`, {
      method: 'POST',
      headers: {},
    });
    return handleResponse<{ ok: true; message: string }>(response);
  },

  /**
   * Delete an API key permanently
   * Requires master API key
   */
  async deleteApiKey(keyId: string): Promise<{ ok: true; message: string }> {
    const response = await fetchAdmin(`/v1/keys/${keyId}`, {
      method: 'DELETE',
      headers: {},
    });
    return handleResponse<{ ok: true; message: string }>(response);
  },

  // ====================
  // RAG / Knowledge Base
  // ====================
  
  /**
   * Ingest content into the knowledge base
   * Requires master API key
   */
  async ingestDocument(request: RAGIngestRequest): Promise<RAGIngestResponse> {
    const response = await fetchAdmin('/v1/rag/ingest', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(request),
    });
    return handleResponse<RAGIngestResponse>(response);
  },

  /**
   * Check the status of a RAG ingestion job
   * Requires master API key
   */
  async getRAGJobStatus(jobId: string): Promise<RAGJobResponse> {
    const response = await fetchAdmin(`/v1/rag/jobs/${jobId}`, {
      headers: {},
    });
    return handleResponse<RAGJobResponse>(response);
  },

  /**
   * Search the knowledge base
   * Requires master API key
   */
  async searchKnowledgeBase(
    tenantId: string,
    query: string,
    limit: number = 5
  ): Promise<RAGSearchResponse> {
    const params = new URLSearchParams({ tenantId, query, limit: String(limit) });
    const response = await fetchAdmin(`/v1/rag/search?${params}`, {
      headers: {},
    });
    return handleResponse<RAGSearchResponse>(response);
  },

  /**
   * Upload and ingest a file into the knowledge base
   * Requires master API key
   * Supports: .txt, .md, .json, .pdf, .docx, .csv
   */
  async uploadDocument(
    file: File,
    tenantId: string = 'default',
    metadata?: Record<string, unknown>
  ): Promise<RAGUploadResponse> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('tenantId', tenantId);
    if (metadata) {
      formData.append('metadata', JSON.stringify(metadata));
    }

    const response = await fetchAdmin('/v1/rag/upload', {
      method: 'POST',
      headers: {        // Note: Don't set Content-Type for FormData, browser will set it with boundary
      },
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new AdminAPIError(
        errorData.error || `HTTP ${response.status}: ${response.statusText}`,
        response.status,
        errorData
      );
    }

    const data = await response.json();
    if (!data.ok) {
      throw new AdminAPIError(
        data.error || 'Upload failed',
        response.status,
        data
      );
    }

    return data as RAGUploadResponse;
  },

  // ====================
  // Tools Management
  // ====================

  /**
   * List all tools (built-in + custom)
   * Requires master API key
   */
  async listTools(): Promise<ListToolsResponse> {
    const response = await fetchAdmin('/v1/admin/tools', {
      headers: {},
    });
    return handleResponse<ListToolsResponse>(response);
  },

  /**
   * Get details of a specific custom tool
   * Requires master API key
   */
  async getTool(toolId: string): Promise<GetToolResponse> {
    const response = await fetchAdmin(`/v1/admin/tools/${toolId}`, {
      headers: {},
    });
    return handleResponse<GetToolResponse>(response);
  },

  /**
   * Create a new custom tool
   * Requires master API key
   */
  async createTool(request: CreateToolRequest): Promise<CreateToolResponse> {
    const response = await fetchAdmin('/v1/admin/tools', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(request),
    });
    return handleResponse<CreateToolResponse>(response);
  },

  /**
   * Update an existing custom tool
   * Requires master API key
   */
  async updateTool(toolId: string, request: UpdateToolRequest): Promise<UpdateToolResponse> {
    const response = await fetchAdmin(`/v1/admin/tools/${toolId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(request),
    });
    return handleResponse<UpdateToolResponse>(response);
  },

  /**
   * Delete a custom tool permanently
   * Requires master API key
   */
  async deleteTool(toolId: string): Promise<DeleteToolResponse> {
    const response = await fetchAdmin(`/v1/admin/tools/${toolId}`, {
      method: 'DELETE',
      headers: {},
    });
    return handleResponse<DeleteToolResponse>(response);
  },

  // ====================
  // Projects Management
  // ====================

  /**
   * List all projects
   * Requires master API key
   */
  async listProjects(): Promise<ListProjectsResponse> {
    const response = await fetchAdmin('/v1/admin/projects', {
      headers: {},
    });
    return handleResponse<ListProjectsResponse>(response);
  },

  /**
   * Get a specific project by ID
   * Requires master API key
   */
  async getProject(projectId: string): Promise<GetProjectResponse> {
    const response = await fetchAdmin(`/v1/admin/projects/${projectId}`, {
      headers: {},
    });
    return handleResponse<GetProjectResponse>(response);
  },

  /**
   * Get project character markdown
   * Requires master API key
   */
  async getProjectCharacter(projectId: string): Promise<GetProjectCharacterResponse> {
    const response = await fetchAdmin(`/v1/admin/projects/${projectId}/character`, {
      headers: {},
    });
    return handleResponse<GetProjectCharacterResponse>(response);
  },

  /**
   * Create a new project
   * Requires master API key
   */
  async createProject(request: CreateProjectRequest): Promise<CreateProjectResponse> {
    const response = await fetchAdmin('/v1/admin/projects', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(request),
    });
    return handleResponse<CreateProjectResponse>(response);
  },

  /**
   * Update an existing project
   * Requires master API key
   */
  async updateProject(projectId: string, request: UpdateProjectRequest): Promise<UpdateProjectResponse> {
    const response = await fetchAdmin(`/v1/admin/projects/${projectId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(request),
    });
    return handleResponse<UpdateProjectResponse>(response);
  },

  /**
   * Delete a project permanently
   * Requires master API key
   */
  async deleteProject(projectId: string): Promise<DeleteProjectResponse> {
    const response = await fetchAdmin(`/v1/admin/projects/${projectId}`, {
      method: 'DELETE',
      headers: {},
    });
    return handleResponse<DeleteProjectResponse>(response);
  },

  // ====================
  // Agents Management
  // ====================

  /**
   * List all agents (optionally filtered by project)
   * Requires master API key
   */
  async listAgents(projectId?: string): Promise<ListAgentsResponse> {
    const params = new URLSearchParams();
    if (projectId) {
      params.append('projectId', projectId);
    }
    const path = `/v1/admin/agents${params.toString() ? `?${params.toString()}` : ''}`;
    const response = await fetchAdmin(path);
    return handleResponse<ListAgentsResponse>(response);
  },

  /**
   * Get available agent roles
   * Requires master API key
   */
  async getAgentRoles(): Promise<GetAgentRolesResponse> {
    const response = await fetchAdmin('/v1/admin/agents/roles', {
      headers: {},
    });
    return handleResponse<GetAgentRolesResponse>(response);
  },

  /**
   * Get a specific agent by ID
   * Requires master API key
   */
  async getAgent(agentId: string): Promise<GetAgentResponse> {
    const response = await fetchAdmin(`/v1/admin/agents/${agentId}`, {
      headers: {},
    });
    return handleResponse<GetAgentResponse>(response);
  },

  /**
   * Create a new agent
   * Requires master API key
   */
  async createAgent(request: CreateAgentRequest): Promise<CreateAgentResponse> {
    const response = await fetchAdmin('/v1/admin/agents', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(request),
    });
    return handleResponse<CreateAgentResponse>(response);
  },

  /**
   * Update an existing agent
   * Requires master API key
   */
  async updateAgent(agentId: string, request: UpdateAgentRequest): Promise<UpdateAgentResponse> {
    const response = await fetchAdmin(`/v1/admin/agents/${agentId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(request),
    });
    return handleResponse<UpdateAgentResponse>(response);
  },

  /**
   * Delete an agent permanently
   * Requires master API key
   */
  async deleteAgent(agentId: string): Promise<DeleteAgentResponse> {
    const response = await fetchAdmin(`/v1/admin/agents/${agentId}`, {
      method: 'DELETE',
      headers: {},
    });
    return handleResponse<DeleteAgentResponse>(response);
  },
};

export default AdminAPI;
