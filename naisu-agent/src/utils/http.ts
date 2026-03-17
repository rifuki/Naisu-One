import type { FastifyRequest } from "fastify";

/**
 * Get client IP address from request
 * Respects X-Forwarded-For header when trustProxy is enabled
 */
export function getClientIp(request: FastifyRequest, trustProxy = true): string {
  // Get IP from various sources
  
  // 1. Try X-Forwarded-For header (if behind proxy and trusting proxies)
  if (trustProxy) {
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded) {
      // X-Forwarded-For can contain multiple IPs, take the first one
      const firstIp = forwarded.split(",")[0]?.trim();
      if (firstIp) return firstIp;
    }
  }

  // 2. Try X-Real-IP header (common in Nginx setups)
  if (trustProxy) {
    const realIp = request.headers["x-real-ip"];
    if (typeof realIp === "string" && realIp) {
      return realIp;
    }
  }

  // 3. Use Fastify's built-in IP detection
  // @ts-ignore - ip property exists but types may vary
  const fastifyIp: string | undefined = request.ip ?? request.socket?.remoteAddress;
  
  if (fastifyIp) {
    // Handle IPv6 localhost
    if (fastifyIp === "::1" || fastifyIp === "::ffff:127.0.0.1") {
      return "127.0.0.1";
    }
    // Handle IPv6 mapped IPv4
    if (fastifyIp.startsWith("::ffff:")) {
      return fastifyIp.slice(7);
    }
    return fastifyIp;
  }

  // Fallback
  return "unknown";
}

export async function httpJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${body.slice(0, 300)}`);
  }

  return (await response.json()) as T;
}
