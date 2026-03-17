import { z } from "zod";

export const RAGIngestSchema = z.object({
  tenantId: z.string().min(1),
  source: z.string().min(1),
  content: z.string().min(1),
  metadata: z.record(z.any()).optional()
});

export const RAGJobQuerySchema = z.object({
  jobId: z.string().min(1)
});

export const RAGSearchSchema = z.object({
  tenantId: z.string().min(1),
  query: z.string().min(1),
  limit: z.coerce.number().int().positive().max(20).default(5)
});
