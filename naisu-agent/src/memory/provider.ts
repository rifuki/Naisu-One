import type { MemoryItem, MemorySearchResult } from "./types.js";

export type MemoryProvider = {
  init(): Promise<void>;
  upsert(projectId: string, userId: string, text: string, tags?: string[]): Promise<MemoryItem>;
  listRecent(projectId: string, userId: string, limit?: number): MemoryItem[];
  semanticSearch(projectId: string, userId: string, query: string, limit?: number): Promise<MemorySearchResult[]>;
};
