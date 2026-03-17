import { readJsonFile, writeJsonFile } from "../utils/json-store.js";
import type { ApiKey } from "./types.js";

const API_KEYS_PATH = "src/data/api-keys.json";

export class ApiKeyStore {
  private keys: Map<string, ApiKey> = new Map();
  private keyHashToId: Map<string, string> = new Map();

  async init(): Promise<void> {
    const data = await readJsonFile<Record<string, ApiKey>>(API_KEYS_PATH, {});
    this.keys = new Map(Object.entries(data));
    
    // Build reverse lookup for key hash validation
    this.keyHashToId.clear();
    for (const [id, key] of this.keys) {
      this.keyHashToId.set(key.keyHash, id);
    }
  }

  async save(apiKey: ApiKey): Promise<void> {
    this.keys.set(apiKey.id, apiKey);
    this.keyHashToId.set(apiKey.keyHash, apiKey.id);
    await this.persist();
  }

  async delete(id: string): Promise<boolean> {
    const key = this.keys.get(id);
    if (!key) return false;
    
    this.keys.delete(id);
    this.keyHashToId.delete(key.keyHash);
    await this.persist();
    return true;
  }

  getById(id: string): ApiKey | undefined {
    return this.keys.get(id);
  }

  getByKeyHash(keyHash: string): ApiKey | undefined {
    const id = this.keyHashToId.get(keyHash);
    if (!id) return undefined;
    return this.keys.get(id);
  }

  getAll(): ApiKey[] {
    return Array.from(this.keys.values());
  }

  getAllActive(): ApiKey[] {
    return this.getAll().filter(k => k.isActive);
  }

  async updateLastUsed(id: string): Promise<void> {
    const key = this.keys.get(id);
    if (key) {
      key.lastUsedAt = new Date().toISOString();
      await this.persist();
    }
  }

  async revoke(id: string): Promise<boolean> {
    const key = this.keys.get(id);
    if (!key) return false;
    
    key.isActive = false;
    await this.persist();
    return true;
  }

  async activate(id: string): Promise<boolean> {
    const key = this.keys.get(id);
    if (!key) return false;
    
    key.isActive = true;
    await this.persist();
    return true;
  }

  private async persist(): Promise<void> {
    const data = Object.fromEntries(this.keys);
    await writeJsonFile(API_KEYS_PATH, data);
  }
}
