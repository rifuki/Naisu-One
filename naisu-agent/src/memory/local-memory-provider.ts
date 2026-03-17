import { MemoryManager } from "./memory-manager.js";
import type { MemoryProvider } from "./provider.js";

export class LocalMemoryProvider implements MemoryProvider {
  private manager = new MemoryManager();

  async init(): Promise<void> {
    await this.manager.init();
  }

  upsert(projectId: string, userId: string, text: string, tags: string[] = []) {
    return this.manager.upsert(projectId, userId, text, tags);
  }

  listRecent(projectId: string, userId: string, limit = 10) {
    return this.manager.listRecent(projectId, userId, limit);
  }

  semanticSearch(projectId: string, userId: string, query: string, limit = 5) {
    return this.manager.semanticSearch(projectId, userId, query, limit);
  }
}
