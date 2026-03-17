import { createEmbeddings } from "../llm/embeddings-factory.js";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { getRedisClient, redisKey } from "../utils/redis.js";
import { createLogger } from "../utils/logger.js";
import type { MemoryProvider } from "./provider.js";
import type { MemoryItem, MemorySearchResult } from "./types.js";

const log = createLogger("RedisMemoryProvider");

function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < len; i += 1) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom > 0 ? dot / denom : 0;
}

// Simple keyword matching fallback when embeddings fail
function keywordScore(query: string, text: string): number {
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const textLower = text.toLowerCase();
  
  if (queryWords.length === 0) return 0;
  
  const matches = queryWords.filter(word => textLower.includes(word)).length;
  return matches / queryWords.length;
}

// Create composite key for project + user
function getUserKey(projectId: string, userId: string): string {
  return `${projectId}:${userId}`;
}

export class RedisMemoryProvider implements MemoryProvider {
  private embeddings = createEmbeddings();
  private embeddingsAvailable = true;

  async init(): Promise<void> {
    log.info("Initializing RedisMemoryProvider");
    await getRedisClient();
    log.info("RedisMemoryProvider initialized");
  }

  async upsert(projectId: string, userId: string, text: string, tags: string[] = []): Promise<MemoryItem> {
    log.debug(`Saving memory to Redis for project: ${projectId}, user: ${userId}`);
    const redis = await getRedisClient();
    const now = new Date().toISOString();
    
    let embedding: number[] | undefined;

    // Try to generate embedding, but don't fail if it doesn't work
    if (this.embeddingsAvailable) {
      try {
        embedding = await this.embeddings.embedQuery(text);
      } catch (error) {
        log.error("Failed to generate embedding, continuing without it", error as Error);
        this.embeddingsAvailable = false;
        embedding = undefined;
      }
    }

    const item: MemoryItem = {
      id: randomUUID(),
      projectId,
      userId,
      text,
      tags,
      createdAt: now,
      updatedAt: now,
      embedding
    };

    const key = getUserKey(projectId, userId);
    await redis.rPush(redisKey("memory", key), JSON.stringify(item));
    await redis.lTrim(redisKey("memory", key), -1000, -1);
    
    log.info(`Memory saved to Redis`, { itemId: item.id, hasEmbedding: !!embedding });
    return item;
  }

  listRecent(projectId: string, userId: string, limit = 10): MemoryItem[] {
    // keep sync shape; runtime should rely on semanticSearch for redis memory retrieval.
    return [];
  }

  async semanticSearch(projectId: string, userId: string, query: string, limit = 5): Promise<MemorySearchResult[]> {
    log.debug(`Searching Redis memory for project: ${projectId}, user: ${userId}`, { query });
    const redis = await getRedisClient();
    
    const key = getUserKey(projectId, userId);
    const raw = await redis.lRange(redisKey("memory", key), 0, -1);
    
    const items = raw
      .map((line) => {
        try {
          return JSON.parse(line) as MemoryItem;
        } catch {
          return null;
        }
      })
      .filter((x): x is MemoryItem => Boolean(x));

    if (items.length === 0) {
      log.debug("No memory items found in Redis");
      return [];
    }

    // Try semantic search with embeddings first
    const candidatesWithEmbeddings = items.filter(x => x.embedding?.length);
    
    if (candidatesWithEmbeddings.length > 0 && this.embeddingsAvailable) {
      try {
        const qEmbedding = await this.embeddings.embedQuery(query);
        
        const results = candidatesWithEmbeddings
          .map((item) => ({ ...item, score: cosine(qEmbedding, item.embedding ?? []) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
        
        log.info(`Semantic search completed`, { resultsCount: results.length });
        return results;
      } catch (error) {
        log.error("Semantic search failed, falling back to keyword search", error as Error);
        this.embeddingsAvailable = false;
      }
    }

    // Fallback to keyword matching
    const results = items
      .map((item) => ({ ...item, score: keywordScore(query, item.text) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    
    log.info(`Keyword search completed`, { resultsCount: results.length });
    return results;
  }
}
