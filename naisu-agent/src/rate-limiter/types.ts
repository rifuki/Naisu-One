/**
 * Rate Limiter Types
 * Production-ready rate limiting with Redis and JSON backends
 */

export interface RateLimitEntry {
  /** Current request count */
  count: number;
  /** Window start timestamp (ISO string) */
  windowStart: string;
  /** Window expiry timestamp (ISO string) */
  windowExpiry: string;
}

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Total limit for the window */
  limit: number;
  /** Remaining requests in current window */
  remaining: number;
  /** When the current window resets */
  resetAt: Date;
  /** Current request count */
  currentCount: number;
  /** Window duration in seconds */
  windowSeconds: number;
}

export interface RateLimiterProvider {
  /**
   * Initialize the rate limiter
   */
  init(): Promise<void>;

  /**
   * Check and consume a request for the given identifier
   * @param identifier - Unique identifier (device ID, IP, or user ID)
   * @param limit - Maximum requests allowed in the window
   * @param windowSeconds - Time window in seconds
   * @returns Rate limit result
   */
  consume(identifier: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;

  /**
   * Get current rate limit status without consuming
   * @param identifier - Unique identifier
   * @param limit - Maximum requests allowed in the window
   * @param windowSeconds - Time window in seconds
   * @returns Rate limit result (current status)
   */
  check(identifier: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;

  /**
   * Reset rate limit for an identifier
   * @param identifier - Unique identifier
   */
  reset(identifier: string): Promise<void>;
}

/** Rate limit configuration */
export interface RateLimitConfig {
  /** Maximum requests per window (default: 10) */
  maxRequests: number;
  /** Window duration in seconds (default: 3600 = 1 hour) */
  windowSeconds: number;
  /** Header name for device ID (default: X-Device-ID) */
  deviceIdHeader: string;
  /** Whether to trust X-Forwarded-For header for IP (default: true) */
  trustProxy: boolean;
}

/** Default rate limit config */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  maxRequests: 10,
  windowSeconds: 3600, // 1 hour
  deviceIdHeader: "X-Device-ID",
  trustProxy: true
};
