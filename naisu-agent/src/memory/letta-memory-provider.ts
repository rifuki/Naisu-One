import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { httpJson } from "../utils/http.js";
import type { MemoryItem, MemorySearchResult } from "./types.js";
import type { MemoryProvider } from "./provider.js";

type LettaMemoryRecord = {
  id?: string;
  userId: string;
  text: string;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
};

export class LettaMemoryProvider implements MemoryProvider {
  private get enabled(): boolean {
    return Boolean(env.LETTA_BASE_URL && env.LETTA_API_KEY);
  }

  async init(): Promise<void> {
    if (!this.enabled) return;
    await httpJson<{ ok: boolean }>(`${env.LETTA_BASE_URL}/health`, {
      headers: { Authorization: `Bearer ${env.LETTA_API_KEY}` }
    });
  }

  async upsert(projectId: string, userId: string, text: string, tags: string[] = []): Promise<MemoryItem> {
    if (!this.enabled) {
      const now = new Date().toISOString();
      return {
        id: `letta-local-${randomUUID()}`,
        projectId,
        userId,
        text,
        tags,
        createdAt: now,
        updatedAt: now,
        embedding: undefined
      };
    }

    // Include projectId in the userId for Letta (composite key)
    const compositeUserId = `${projectId}:${userId}`;
    
    const created = await httpJson<LettaMemoryRecord>(`${env.LETTA_BASE_URL}/v1/memory/upsert`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.LETTA_API_KEY}` },
      body: JSON.stringify({ userId: compositeUserId, text, tags })
    });

    const now = new Date().toISOString();
    return {
      id: created.id ?? `letta-${randomUUID()}`,
      projectId,
      userId: created.userId,
      text: created.text,
      tags: created.tags ?? [],
      createdAt: created.createdAt ?? now,
      updatedAt: created.updatedAt ?? now,
      embedding: undefined
    };
  }

  listRecent(_projectId: string, _userId: string, _limit = 10): MemoryItem[] {
    // Keep sync API. Long-term path should call semanticSearch for Letta-backed retrieval.
    return [];
  }

  async semanticSearch(projectId: string, userId: string, query: string, limit = 5): Promise<MemorySearchResult[]> {
    if (!this.enabled) return [];

    // Include projectId in the userId for Letta (composite key)
    const compositeUserId = `${projectId}:${userId}`;

    const result = await httpJson<{ items: Array<MemoryItem & { score?: number }> }>(
      `${env.LETTA_BASE_URL}/v1/memory/search`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${env.LETTA_API_KEY}` },
        body: JSON.stringify({ userId: compositeUserId, query, limit })
      }
    );

    // Add projectId back to results
    return (result.items ?? []).map((item) => ({ 
      ...item, 
      projectId,
      score: item.score ?? 0 
    }));
  }
}
