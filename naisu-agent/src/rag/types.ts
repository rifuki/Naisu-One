export type RAGDocument = {
  id: string;
  tenantId: string;
  source: string;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type RAGChunk = {
  id: string;
  documentId: string;
  tenantId: string;
  text: string;
  index: number;
  metadata?: Record<string, unknown>;
};

export type RAGIngestJob = {
  id: string;
  tenantId: string;
  status: "pending" | "processing" | "completed" | "failed";
  source: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
  chunks?: number;
};
