import { env } from "../config/env.js";
import { httpJson } from "../utils/http.js";
import type { RetrievedContext, RetrieverProvider } from "./retriever-provider.js";

type LlamaIndexRetrieveResponse = {
  nodes?: Array<{
    id?: string;
    text?: string;
    score?: number;
    metadata?: Record<string, unknown>;
  }>;
};

export class LlamaIndexRetriever implements RetrieverProvider {
  private get enabled(): boolean {
    return Boolean(env.LLAMAINDEX_BASE_URL && env.LLAMAINDEX_API_KEY);
  }

  async retrieve(userId: string, query: string, limit = 5): Promise<RetrievedContext[]> {
    if (!this.enabled) return [];

    const response = await httpJson<LlamaIndexRetrieveResponse>(`${env.LLAMAINDEX_BASE_URL}/v1/retrieve`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.LLAMAINDEX_API_KEY}` },
      body: JSON.stringify({ userId, query, topK: limit })
    });

    return (response.nodes ?? []).map((node, index) => ({
      id: node.id ?? `llama-${index + 1}`,
      content: node.text ?? "",
      score: node.score ?? 0,
      ...(node.metadata ? { metadata: node.metadata } : {})
    }));
  }
}
