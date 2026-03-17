import { chunkText } from "./chunker.js";
import { RAGStore } from "./store.js";

export class RAGService {
  constructor(private readonly store: RAGStore) {}

  async ingest(params: {
    tenantId: string;
    source: string;
    content: string;
    metadata?: Record<string, unknown>;
  }) {
    const job = await this.store.createJob(params.tenantId, params.source);

    try {
      await this.store.updateJob(job.id, { status: "processing" });

      const doc = await this.store.createDocument({
        tenantId: params.tenantId,
        source: params.source,
        content: params.content,
        ...(params.metadata ? { metadata: params.metadata } : {})
      });

      const chunks = chunkText(params.content).map((text, index) => ({
        documentId: doc.id,
        tenantId: params.tenantId,
        text,
        index,
        ...(params.metadata ? { metadata: params.metadata } : {})
      }));

      await this.store.createChunks(chunks);
      await this.store.updateJob(job.id, { status: "completed", chunks: chunks.length });

      return { jobId: job.id, documentId: doc.id, chunkCount: chunks.length };
    } catch (error) {
      await this.store.updateJob(job.id, {
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error"
      });
      throw error;
    }
  }

  getJob(jobId: string) {
    return this.store.getJob(jobId);
  }

  query(tenantId: string, query: string, limit = 5) {
    return this.store.queryChunks(tenantId, query, limit);
  }
}
