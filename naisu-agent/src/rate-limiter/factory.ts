import { env } from "../config/env.js";
import { createLogger } from "../utils/logger.js";
import { JsonRateLimiter } from "./json-rate-limiter.js";
import { RedisRateLimiter } from "./redis-rate-limiter.js";
import type { RateLimiterProvider, RateLimitConfig } from "./types.js";

const log = createLogger("RateLimiterFactory");

export type RateLimiterBackend = "json" | "redis";

/**
 * Create rate limiter provider based on configuration
 * Defaults to JSON for simplicity, Redis for production
 */
export function createRateLimiter(backend?: RateLimiterBackend): RateLimiterProvider {
  const selectedBackend = backend ?? env.RATE_LIMIT_BACKEND ?? "json";

  log.info(`Creating rate limiter`, { backend: selectedBackend });

  if (selectedBackend === "redis") {
    return new RedisRateLimiter();
  }

  return new JsonRateLimiter();
}

/**
 * Get rate limit configuration from environment
 */
export function getRateLimitConfig(): RateLimitConfig {
  return {
    maxRequests: env.RATE_LIMIT_MAX_REQUESTS ?? 10,
    windowSeconds: env.RATE_LIMIT_WINDOW_SECONDS ?? 3600,
    deviceIdHeader: env.RATE_LIMIT_DEVICE_HEADER ?? "X-Device-ID",
    trustProxy: env.RATE_LIMIT_TRUST_PROXY !== "false"
  };
}

/**
 * Check if rate limiting is enabled
 */
export function isRateLimitingEnabled(): boolean {
  return env.RATE_LIMIT_ENABLED === "true";
}

/**
 * Get rate limit for specific endpoint type
 */
export function getEndpointRateLimit(endpointType: "chat" | "admin" | "default"): { limit: number; windowSeconds: number } {
  const defaultConfig = getRateLimitConfig();
  
  switch (endpointType) {
    case "chat":
      return {
        limit: env.RATE_LIMIT_CHAT_MAX ?? defaultConfig.maxRequests,
        windowSeconds: env.RATE_LIMIT_CHAT_WINDOW ?? defaultConfig.windowSeconds
      };
    case "admin":
      // Admin endpoints typically have higher or no limits
      return {
        limit: env.RATE_LIMIT_ADMIN_MAX ?? 1000,
        windowSeconds: env.RATE_LIMIT_ADMIN_WINDOW ?? 3600
      };
    default:
      return {
        limit: defaultConfig.maxRequests,
        windowSeconds: defaultConfig.windowSeconds
      };
  }
}
