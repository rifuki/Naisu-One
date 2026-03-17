export type RetrievedContext = {
  id: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
};

export type RetrieverProvider = {
  retrieve(userId: string, query: string, limit?: number): Promise<RetrievedContext[]>;
};
