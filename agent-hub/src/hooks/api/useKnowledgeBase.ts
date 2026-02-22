import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AdminAPI,
  RAGIngestRequest,
  RAGIngestResponse,
  RAGUploadResponse,
  RAGJob,
  RAGSearchResult,
  AdminAPIError,
} from '@/services/adminApi';

const JOBS_QUERY_KEY = 'rag-jobs';

interface UseIngestDocumentOptions {
  onSuccess?: (data: RAGIngestResponse) => void;
  onError?: (error: AdminAPIError) => void;
}

/**
 * Hook for ingesting content into the knowledge base
 * Uses POST /v1/rag/ingest
 */
export function useIngestDocument(options: UseIngestDocumentOptions = {}) {
  const queryClient = useQueryClient();

  return useMutation<RAGIngestResponse, AdminAPIError, RAGIngestRequest>({
    mutationFn: (request) => AdminAPI.ingestDocument(request),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [JOBS_QUERY_KEY] });
      options.onSuccess?.(data);
    },
    onError: options.onError,
  });
}

interface UseRAGJobStatusOptions {
  enabled?: boolean;
  refetchInterval?: number | false;
}

/**
 * Hook for checking RAG job status
 * Uses GET /v1/rag/jobs/:jobId
 */
export function useRAGJobStatus(
  jobId: string | null,
  options: UseRAGJobStatusOptions = {}
) {
  return useQuery<RAGJob, AdminAPIError>({
    queryKey: [JOBS_QUERY_KEY, jobId],
    queryFn: async () => {
      if (!jobId) throw new Error('Job ID is required');
      const response = await AdminAPI.getRAGJobStatus(jobId);
      return response.job;
    },
    enabled: !!jobId && options.enabled !== false,
    refetchInterval: (query) => {
      const data = query.state.data;
      // Auto-refetch while job is pending or processing
      if (data?.status === 'pending' || data?.status === 'processing') {
        return options.refetchInterval || 2000;
      }
      return false;
    },
  });
}

interface UseSearchKnowledgeBaseOptions {
  enabled?: boolean;
}

/**
 * Hook for searching the knowledge base
 * Uses GET /v1/rag/search
 */
export function useSearchKnowledgeBase(
  tenantId: string,
  query: string,
  limit: number = 5,
  options: UseSearchKnowledgeBaseOptions = {}
) {
  return useQuery<RAGSearchResult[], AdminAPIError>({
    queryKey: ['rag-search', tenantId, query, limit],
    queryFn: async () => {
      const response = await AdminAPI.searchKnowledgeBase(tenantId, query, limit);
      return response.items;
    },
    enabled: options.enabled !== false && !!query && query.length > 0,
  });
}

/**
 * Hook for manual knowledge base search (returns mutation)
 * Uses GET /v1/rag/search
 */
export function useSearchKnowledgeBaseMutation() {
  return useMutation<
    RAGSearchResult[],
    AdminAPIError,
    { tenantId: string; query: string; limit?: number }
  >({
    mutationFn: async ({ tenantId, query, limit = 5 }) => {
      const response = await AdminAPI.searchKnowledgeBase(tenantId, query, limit);
      return response.items;
    },
  });
}

interface UseUploadDocumentOptions {
  onSuccess?: (data: RAGUploadResponse) => void;
  onError?: (error: AdminAPIError) => void;
}

export interface UploadDocumentInput {
  file: File;
  tenantId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Hook for uploading and ingesting a file into the knowledge base
 * Uses POST /v1/rag/upload
 * Supports: .txt, .md, .json, .pdf, .docx, .csv
 */
export function useUploadDocument(options: UseUploadDocumentOptions = {}) {
  const queryClient = useQueryClient();

  return useMutation<RAGUploadResponse, AdminAPIError, UploadDocumentInput>({
    mutationFn: ({ file, tenantId, metadata }) => 
      AdminAPI.uploadDocument(file, tenantId, metadata),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [JOBS_QUERY_KEY] });
      options.onSuccess?.(data);
    },
    onError: options.onError,
  });
}

export default useIngestDocument;
