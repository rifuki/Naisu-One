import type { FastifyReply, FastifyRequest } from "fastify";
import type { RateLimiterProvider, RateLimitConfig } from "../rate-limiter/types.js";
import { createLogger } from "../utils/logger.js";
import { getClientIp } from "../utils/http.js";

const log = createLogger("RateLimitMiddleware");

/**
 * Request with rate limit info attached
 */
export interface RateLimitedRequest extends FastifyRequest {
  rateLimit?: {
    identifier: string;
    allowed: boolean;
    remaining: number;
    resetAt: Date;
    limit: number;
  };
}

/**
 * Rate limit middleware options
 */
export interface RateLimitOptions {
  /** Max requests per window (overrides config) */
  limit?: number;
  /** Window in seconds (overrides config) */
  windowSeconds?: number;
  /** Skip rate limiting for this request */
  skip?: (req: FastifyRequest) => boolean;
  /** Custom identifier extractor (default: device ID -> IP) */
  identifierExtractor?: (req: FastifyRequest) => string;
}

/**
 * Create rate limiting middleware
 * @param rateLimiter - Rate limiter provider instance
 * @param config - Rate limit configuration
 * @param options - Optional overrides
 */
export function createRateLimitMiddleware(
  rateLimiter: RateLimiterProvider,
  config: RateLimitConfig,
  options?: RateLimitOptions
) {
  return async function rateLimitMiddleware(
    request: RateLimitedRequest,
    reply: FastifyReply
  ): Promise<void> {
    // Check if we should skip this request
    if (options?.skip?.(request)) {
      return;
    }

    // Extract identifier (device ID or IP)
    const identifier = options?.identifierExtractor?.(request) ?? extractIdentifier(request, config);
    
    // Get rate limit settings
    const limit = options?.limit ?? config.maxRequests;
    const windowSeconds = options?.windowSeconds ?? config.windowSeconds;

    log.debug(`Checking rate limit`, {
      identifier: identifier.slice(0, 20) + "...",
      path: request.url,
      limit,
      windowSeconds
    });

    // Consume rate limit
    const result = await rateLimiter.consume(identifier, limit, windowSeconds);

    // Attach rate limit info to request for later use
    request.rateLimit = {
      identifier,
      allowed: result.allowed,
      remaining: result.remaining,
      resetAt: result.resetAt,
      limit: result.limit
    };

    // Add rate limit headers to all responses
    reply.header("X-RateLimit-Limit", result.limit.toString());
    reply.header("X-RateLimit-Remaining", Math.max(0, result.remaining).toString());
    reply.header("X-RateLimit-Reset", Math.floor(result.resetAt.getTime() / 1000).toString());

    // If not allowed, reject the request
    if (!result.allowed) {
      log.warn(`Rate limit exceeded`, {
        identifier: identifier.slice(0, 20) + "...",
        path: request.url,
        count: result.currentCount,
        limit
      });

      reply.code(429).send({
        ok: false,
        error: "Too Many Requests",
        message: `Rate limit exceeded. Try again after ${result.resetAt.toISOString()}`,
        retryAfter: Math.ceil((result.resetAt.getTime() - Date.now()) / 1000),
        limit: result.limit,
        windowSeconds: result.windowSeconds
      });
      return;
    }

    log.debug(`Rate limit allowed`, {
      identifier: identifier.slice(0, 20) + "...",
      remaining: result.remaining
    });
  };
}

/**
 * Create rate limit info middleware (for GET /rate-limit endpoint)
 * Returns current rate limit status without consuming
 */
export function createRateLimitInfoMiddleware(
  rateLimiter: RateLimiterProvider,
  config: RateLimitConfig
) {
  return async function rateLimitInfoMiddleware(
    request: RateLimitedRequest,
    reply: FastifyReply
  ): Promise<void> {
    const identifier = extractIdentifier(request, config);
    const result = await rateLimiter.check(identifier, config.maxRequests, config.windowSeconds);

    // Attach info to request
    request.rateLimit = {
      identifier,
      allowed: result.allowed,
      remaining: result.remaining,
      resetAt: result.resetAt,
      limit: result.limit
    };

    // Add headers
    reply.header("X-RateLimit-Limit", result.limit.toString());
    reply.header("X-RateLimit-Remaining", result.remaining.toString());
    reply.header("X-RateLimit-Reset", Math.floor(result.resetAt.getTime() / 1000).toString());
  };
}

/**
 * Extract identifier from request
 * Priority: 1) Device ID header, 2) IP address
 */
function extractIdentifier(request: FastifyRequest, config: RateLimitConfig): string {
  // Try device ID header first
  const deviceId = request.headers[config.deviceIdHeader.toLowerCase()] as string | undefined;
  
  if (deviceId && deviceId.trim()) {
    log.debug(`Using device ID: ${deviceId.slice(0, 10)}...`);
    return `device:${deviceId}`;
  }

  // Fallback to IP address
  const ip = getClientIp(request, config.trustProxy);
  log.debug(`Using IP: ${ip}`);
  return `ip:${ip}`;
}

/**
 * Middleware to skip rate limiting for authenticated admin requests
 */
export function skipIfAdmin(request: FastifyRequest): boolean {
  // Check if request has admin/master key authentication
  // This requires the auth middleware to run first
  const authReq = request as FastifyRequest & { isMasterKey?: boolean };
  
  if (authReq.isMasterKey) {
    log.debug("Skipping rate limit for admin request");
    return true;
  }

  return false;
}

/**
 * Middleware to skip rate limiting for specific paths
 */
export function createSkipPathsMiddleware(paths: string[]) {
  return function skipIfPath(request: FastifyRequest): boolean {
    const pathname = request.url.split("?")[0] ?? request.url;
    return paths.some(path => pathname === path || pathname.startsWith(path));
  };
}
