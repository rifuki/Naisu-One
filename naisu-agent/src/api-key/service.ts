import crypto from "node:crypto";
import { generateApiKey, hashApiKey } from "../utils/api-key.js";
import type { 
  ApiKey, 
  ApiKeyCreateInput, 
  ApiKeyCreateResult, 
  ApiKeyListItem 
} from "./types.js";
import { ApiKeyStore } from "./store.js";
import { DEFAULT_PERMISSIONS, PERMISSIONS } from "./types.js";

export class ApiKeyService {
  private store: ApiKeyStore;

  constructor() {
    this.store = new ApiKeyStore();
  }

  async init(): Promise<void> {
    await this.store.init();
  }

  /**
   * Create a new API key
   */
  async createKey(
    input: ApiKeyCreateInput, 
    createdBy: string
  ): Promise<ApiKeyCreateResult> {
    // Generate the actual key
    const key = generateApiKey({ prefix: "sk" });
    const keyHash = hashApiKey(key);
    
    // Extract prefix for identification (first 16 chars after sk-)
    const keyPrefix = key.substring(0, 19); // e.g., "sk-ABC123-xyz..."

    const now = new Date().toISOString();
    const expiresAt = input.expiresInDays 
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : undefined;

    const apiKey: ApiKey = {
      id: crypto.randomUUID(),
      keyHash,
      keyPrefix,
      name: input.name,
      description: input.description,
      permissions: input.permissions ?? DEFAULT_PERMISSIONS,
      createdAt: now,
      expiresAt,
      lastUsedAt: undefined,
      isActive: true,
      createdBy
    };

    await this.store.save(apiKey);

    return {
      key, // Return full key only once at creation
      apiKey
    };
  }

  /**
   * List all API keys (without sensitive data)
   */
  async listKeys(): Promise<ApiKeyListItem[]> {
    const keys = this.store.getAll();
    return keys.map(k => ({
      id: k.id,
      keyPrefix: k.keyPrefix,
      name: k.name,
      description: k.description,
      permissions: k.permissions,
      createdAt: k.createdAt,
      expiresAt: k.expiresAt,
      lastUsedAt: k.lastUsedAt,
      isActive: k.isActive
    }));
  }

  /**
   * Get a key by ID
   */
  async getKey(id: string): Promise<ApiKeyListItem | undefined> {
    const key = this.store.getById(id);
    if (!key) return undefined;
    
    return {
      id: key.id,
      keyPrefix: key.keyPrefix,
      name: key.name,
      description: key.description,
      permissions: key.permissions,
      createdAt: key.createdAt,
      expiresAt: key.expiresAt,
      lastUsedAt: key.lastUsedAt,
      isActive: key.isActive
    };
  }

  /**
   * Revoke/deactivate a key
   */
  async revokeKey(id: string): Promise<boolean> {
    return this.store.revoke(id);
  }

  /**
   * Reactivate a key
   */
  async activateKey(id: string): Promise<boolean> {
    return this.store.activate(id);
  }

  /**
   * Delete a key permanently
   */
  async deleteKey(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  /**
   * Validate a key and check permissions
   */
  async validateKey(
    key: string, 
    requiredPermission?: string
  ): Promise<{ valid: boolean; apiKey?: ApiKey; error?: string }> {
    const keyHash = hashApiKey(key);
    const apiKey = this.store.getByKeyHash(keyHash);

    if (!apiKey) {
      return { valid: false, error: "Invalid API key" };
    }

    if (!apiKey.isActive) {
      return { valid: false, error: "API key is revoked" };
    }

    if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
      return { valid: false, error: "API key has expired" };
    }

    // Check permission
    if (requiredPermission && requiredPermission !== PERMISSIONS.ALL) {
      const hasPermission = apiKey.permissions.includes(PERMISSIONS.ALL) || 
                           apiKey.permissions.includes(requiredPermission);
      if (!hasPermission) {
        return { valid: false, error: `Permission denied: ${requiredPermission}` };
      }
    }

    // Update last used
    await this.store.updateLastUsed(apiKey.id);

    return { valid: true, apiKey };
  }

  /**
   * Check if any keys exist (for initial setup)
   */
  hasKeys(): boolean {
    return this.store.getAll().length > 0;
  }

  /**
   * Count active keys
   */
  countActiveKeys(): number {
    return this.store.getAllActive().length;
  }
}
