import { getRedisClient } from "../utils/redis.js";
import { createLogger } from "../utils/logger.js";
import { env } from "../config/env.js";
import type { RateLimiterProvider, RateLimitResult } from "./types.js";

const log = createLogger("RedisRateLimiter");

const KEY_PREFIX = `${env.REDIS_PREFIX}:ratelimit`;

export class RedisRateLimiter implements RateLimiterProvider {
  private redis: Awaited<ReturnType<typeof getRedisClient>> | null = null;

  async init(): Promise<void> {
    log.info("Initializing Redis rate limiter");
    
    try {
      this.redis = await getRedisClient();
      await this.redis.ping();
      log.info("Redis rate limiter connected");
    } catch (error) {
      log.error("Failed to connect to Redis", error instanceof Error ? error : new Error(String(error)));
      throw new Error("Redis connection failed for rate limiter");
    }
  }

  private getKey(identifier: string, limit: number, windowSeconds: number): string {
    return `${KEY_PREFIX}:${identifier}:${limit}:${windowSeconds}`;
  }

  async consume(identifier: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    if (!this.redis) {
      throw new Error("Redis rate limiter not initialized");
    }

    const key = this.getKey(identifier, limit, windowSeconds);
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const resetAt = new Date(now + windowMs);
    
    try {
      // Get current value and TTL
      const currentValue = await this.redis.get(key);
      const ttl = await this.redis.ttl(key);
      
      let count: number;
      let ttlRemaining: number;
      
      if (currentValue === null || ttl <= 0) {
        // New window
        count = 1;
        ttlRemaining = windowSeconds;
        
        // Set with expiry
        await this.redis.setEx(key, windowSeconds, count.toString());
        
        log.debug(`New rate limit window for ${identifier}`, {
          limit,
          windowSeconds
        });
      } else {
        // Existing window - increment
        count = parseInt(currentValue, 10) + 1;
        ttlRemaining = ttl;
        
        // Update value (keep same TTL)
        await this.redis.setEx(key, ttlRemaining, count.toString());
      }
      
      const resetAtDate = new Date(now + ttlRemaining * 1000);
      const remaining = Math.max(0, limit - count);
      const allowed = count <= limit;
      
      log.debug(`Rate limit consumed`, {
        identifier: identifier.slice(0, 20) + "...",
        count,
        remaining,
        allowed
      });
      
      return {
        allowed,
        limit,
        remaining,
        resetAt: resetAtDate,
        currentCount: count,
        windowSeconds
      };
    } catch (error) {
      log.error(`Redis operation failed for ${identifier}`, error instanceof Error ? error : new Error(String(error)));
      
      // Fail open - allow request but log error
      log.warn("Failing open due to Redis error");
      return {
        allowed: true,
        limit,
        remaining: 1,
        resetAt,
        currentCount: 0,
        windowSeconds
      };
    }
  }

  async check(identifier: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    if (!this.redis) {
      throw new Error("Redis rate limiter not initialized");
    }

    const key = this.getKey(identifier, limit, windowSeconds);
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    
    try {
      const currentValue = await this.redis.get(key);
      const ttl = await this.redis.ttl(key);
      
      if (currentValue === null || ttl <= 0) {
        // No active window
        return {
          allowed: true,
          limit,
          remaining: limit,
          resetAt: new Date(now + windowMs),
          currentCount: 0,
          windowSeconds
        };
      }
      
      const count = parseInt(currentValue, 10);
      const resetAt = new Date(now + ttl * 1000);
      const remaining = Math.max(0, limit - count);
      const allowed = count < limit;
      
      return {
        allowed,
        limit,
        remaining,
        resetAt,
        currentCount: count,
        windowSeconds
      };
    } catch (error) {
      log.error(`Redis check failed for ${identifier}`, error instanceof Error ? error : new Error(String(error)));
      
      // Fail open
      return {
        allowed: true,
        limit,
        remaining: limit,
        resetAt: new Date(now + windowMs),
        currentCount: 0,
        windowSeconds
      };
    }
  }

  async reset(identifier: string): Promise<void> {
    if (!this.redis) {
      throw new Error("Redis rate limiter not initialized");
    }

    // Use Redis scan to find and delete all keys for this identifier
    const pattern = `${KEY_PREFIX}:${identifier}:*`;
    let cursor = 0;
    let deletedCount = 0;
    
    do {
      const result = await this.redis.scan(cursor, { MATCH: pattern, COUNT: 100 });
      cursor = result.cursor;
      const keys = result.keys;
      
      if (keys.length > 0) {
        await this.redis.del(keys);
        deletedCount += keys.length;
      }
    } while (cursor !== 0);
    
    log.info(`Reset rate limit for ${identifier}`, { deleted: deletedCount });
  }
}
