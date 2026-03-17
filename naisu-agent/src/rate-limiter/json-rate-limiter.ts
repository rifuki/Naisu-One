import { readJsonFile, writeJsonFile } from "../utils/json-store.js";
import { createLogger } from "../utils/logger.js";
import type { RateLimiterProvider, RateLimitEntry, RateLimitResult } from "./types.js";

const log = createLogger("JSONRateLimiter");
const PATH = "src/data/rate-limits.json";

export class JsonRateLimiter implements RateLimiterProvider {
  private entries = new Map<string, RateLimitEntry>();

  async init(): Promise<void> {
    log.info("Initializing JSON rate limiter");
    const data = await readJsonFile<Record<string, RateLimitEntry>>(PATH, {});
    
    // Convert to Map and clean up expired entries
    const now = new Date();
    let cleanedCount = 0;
    
    for (const [key, entry] of Object.entries(data)) {
      const expiry = new Date(entry.windowExpiry);
      if (expiry > now) {
        this.entries.set(key, entry);
      } else {
        cleanedCount++;
      }
    }
    
    log.info("JSON rate limiter initialized", { 
      loaded: this.entries.size, 
      cleaned: cleanedCount 
    });
  }

  private async persist(): Promise<void> {
    // Convert Map to object for storage
    const data: Record<string, RateLimitEntry> = {};
    for (const [key, entry] of this.entries) {
      data[key] = entry;
    }
    await writeJsonFile(PATH, data);
  }

  private getKey(identifier: string, limit: number, windowSeconds: number): string {
    // Include limit and window in key to allow different configs per endpoint
    return `${identifier}:${limit}:${windowSeconds}`;
  }

  async consume(identifier: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const key = this.getKey(identifier, limit, windowSeconds);
    const now = new Date();
    
    const existing = this.entries.get(key);
    let entry: RateLimitEntry;
    
    if (!existing || new Date(existing.windowExpiry) <= now) {
      // Create new window
      const windowStart = now;
      const windowExpiry = new Date(now.getTime() + windowSeconds * 1000);
      
      entry = {
        count: 1,
        windowStart: windowStart.toISOString(),
        windowExpiry: windowExpiry.toISOString()
      };
      
      log.debug(`New rate limit window for ${identifier}`, {
        limit,
        windowSeconds,
        windowExpiry
      });
    } else {
      // Increment existing window
      entry = {
        ...existing,
        count: existing.count + 1
      };
    }
    
    this.entries.set(key, entry);
    
    // Persist asynchronously (don't block response)
    this.persist().catch(err => {
      log.error("Failed to persist rate limit", err);
    });
    
    const resetAt = new Date(entry.windowExpiry);
    const remaining = Math.max(0, limit - entry.count);
    const allowed = entry.count <= limit;
    
    log.debug(`Rate limit consumed`, {
      identifier: identifier.slice(0, 20) + "...",
      count: entry.count,
      remaining,
      allowed
    });
    
    return {
      allowed,
      limit,
      remaining,
      resetAt,
      currentCount: entry.count,
      windowSeconds
    };
  }

  async check(identifier: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const key = this.getKey(identifier, limit, windowSeconds);
    const now = new Date();
    
    const existing = this.entries.get(key);
    
    if (!existing || new Date(existing.windowExpiry) <= now) {
      // No active window or expired
      const resetAt = new Date(now.getTime() + windowSeconds * 1000);
      
      return {
        allowed: true,
        limit,
        remaining: limit,
        resetAt,
        currentCount: 0,
        windowSeconds
      };
    }
    
    const resetAt = new Date(existing.windowExpiry);
    const remaining = Math.max(0, limit - existing.count);
    const allowed = existing.count < limit;
    
    return {
      allowed,
      limit,
      remaining,
      resetAt,
      currentCount: existing.count,
      windowSeconds
    };
  }

  async reset(identifier: string): Promise<void> {
    // Remove all entries for this identifier (all limit/window combinations)
    const keysToDelete: string[] = [];
    
    for (const key of this.entries.keys()) {
      if (key.startsWith(`${identifier}:`)) {
        keysToDelete.push(key);
      }
    }
    
    for (const key of keysToDelete) {
      this.entries.delete(key);
    }
    
    log.info(`Reset rate limit for ${identifier}`, { removed: keysToDelete.length });
    
    await this.persist();
  }
}
