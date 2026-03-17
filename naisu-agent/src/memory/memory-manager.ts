import { createEmbeddings } from "../llm/embeddings-factory.js";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { readJsonFile, writeJsonFile } from "../utils/json-store.js";
import { createLogger } from "../utils/logger.js";
import type { MemoryItem, MemorySearchResult } from "./types.js";

const log = createLogger("MemoryManager");

const PATH = "src/data/memory.json";
const MAX_FAST_MEMORY = 200;

// Timeout for individual embedding operations (8 seconds)
const EMBEDDING_OP_TIMEOUT = 8000;

/**
 * Wrap an embedding call with a timeout
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error(`${operation} timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

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

export class MemoryManager {
  private items: MemoryItem[] = [];
  private fastByUser = new Map<string, MemoryItem[]>();
  private embeddings = createEmbeddings();
  private embeddingsAvailable = true;

  async init(): Promise<void> {
    log.info("Initializing MemoryManager");
    this.items = await readJsonFile<MemoryItem[]>(PATH, []);
    for (const item of this.items) this.addToFast(item);
    log.info("MemoryManager initialized", { 
      totalItems: this.items.length,
      users: this.fastByUser.size 
    });
  }

  private addToFast(item: MemoryItem): void {
    const key = getUserKey(item.projectId, item.userId);
    const list = this.fastByUser.get(key) ?? [];
    list.push(item);
    this.fastByUser.set(key, list.slice(-MAX_FAST_MEMORY));
  }

  async upsert(projectId: string, userId: string, text: string, tags: string[] = []): Promise<MemoryItem> {
    log.debug(`Saving memory for project: ${projectId}, user: ${userId}`, { textLength: text.length, tags });
    const startTime = Date.now();
    
    const now = new Date().toISOString();
    let embedding: number[] | undefined;

    // Try to generate embedding, but don't fail if it doesn't work
    if (this.embeddingsAvailable) {
      try {
        embedding = await withTimeout(
          this.embeddings.embedQuery(text),
          EMBEDDING_OP_TIMEOUT,
          "Memory embedding"
        );
        log.debug(`Embedding generated in ${Date.now() - startTime}ms`, { embeddingLength: embedding.length });
      } catch (error) {
        log.error(`Failed to generate embedding after ${Date.now() - startTime}ms, continuing without it`, error as Error);
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

    this.items.push(item);
    this.addToFast(item);
    await writeJsonFile(PATH, this.items);
    
    log.info(`Memory saved in ${Date.now() - startTime}ms`, { 
      itemId: item.id, 
      projectId,
      userId,
      hasEmbedding: !!embedding 
    });
    
    return item;
  }

  listRecent(projectId: string, userId: string, limit = 10): MemoryItem[] {
    const key = getUserKey(projectId, userId);
    return (this.fastByUser.get(key) ?? []).slice(-limit);
  }

  async semanticSearch(projectId: string, userId: string, query: string, limit = 5): Promise<MemorySearchResult[]> {
    const startTime = Date.now();
    log.debug(`Searching memory for project: ${projectId}, user: ${userId}`, { query, limit });
    
    // Filter by both projectId and userId
    const candidates = this.items.filter((x) => x.projectId === projectId && x.userId === userId);
    
    if (candidates.length === 0) {
      log.debug("No memory items found for project/user");
      return [];
    }

    // Try semantic search with embeddings first
    const candidatesWithEmbeddings = candidates.filter(x => x.embedding?.length);
    
    if (candidatesWithEmbeddings.length > 0 && this.embeddingsAvailable) {
      try {
        log.debug(`Using semantic search with ${candidatesWithEmbeddings.length} candidates`);
        
        const qEmbedding = await withTimeout(
          this.embeddings.embedQuery(query),
          EMBEDDING_OP_TIMEOUT,
          "Search query embedding"
        );
        
        const results = candidatesWithEmbeddings
          .map((item) => ({ ...item, score: cosine(qEmbedding, item.embedding ?? []) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
        
        log.info(`Semantic search completed in ${Date.now() - startTime}ms`, { resultsCount: results.length });
        return results;
      } catch (error) {
        log.error(`Semantic search failed after ${Date.now() - startTime}ms, falling back to keyword search`, error as Error);
        this.embeddingsAvailable = false;
      }
    }

    // Fallback to keyword matching
    log.debug(`Using keyword search with ${candidates.length} candidates`);
    const results = candidates
      .map((item) => ({ ...item, score: keywordScore(query, item.text) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    
    log.info(`Keyword search completed in ${Date.now() - startTime}ms`, { resultsCount: results.length });
    return results;
  }
}
