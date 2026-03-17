import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { generateApiKey as genKey, hashApiKey } from "../utils/api-key.js";
import type { ApiKeyService } from "../api-key/service.js";
import { PERMISSIONS } from "../api-key/types.js";

export interface AuthenticatedRequest extends FastifyRequest {
  apiKey?: string;
  apiKeyId?: string;
  apiKeyPermissions?: string[];
  isMasterKey?: boolean;
}

// Public routes that don't require authentication
const PUBLIC_ROUTES = [
  "/health",
  "/v1/oauth/login",
  "/v1/oauth/callback"
];

// Routes that allow API key in request body (POST/PUT/PATCH only)
const ALLOW_BODY_API_KEY = [
  "/v1/chat",
  "/v1/tools/call"
];

// Admin-only routes (only master key can access)
const ADMIN_ONLY_ROUTES = [
  "/v1/admin",         // Admin endpoints (chat, tools, etc.)
  "/v1/rag",           // RAG/Knowledge base management
  "/v1/keys",          // API key management
  "/v1/admin/tools"    // Tool management (create/add tools)
];

/**
 * Check if a route is public (no auth required)
 */
function isPublicRoute(url: string): boolean {
  const pathname = url.split("?")[0] ?? url;
  return PUBLIC_ROUTES.some(route => pathname === route);
}

/**
 * Check if route is admin-only (requires master key)
 */
function isAdminOnlyRoute(url: string): boolean {
  const pathname = url.split("?")[0] ?? url;
  return ADMIN_ONLY_ROUTES.some(route => pathname.startsWith(route));
}

/**
 * Get required permission for a route
 * Returns PERMISSIONS.ALL for admin-only routes (only master key has this)
 */
function getRequiredPermission(url: string): string | undefined {
  const pathname = url.split("?")[0] ?? url;
  
  // Admin-only routes require ALL permission (master key only)
  if (isAdminOnlyRoute(url)) {
    return PERMISSIONS.ALL;
  }
  
  // Regular permission-based routes
  if (pathname.startsWith("/v1/chat")) return PERMISSIONS.CHAT;
  if (pathname.startsWith("/v1/tools")) return PERMISSIONS.TOOLS;
  if (pathname.startsWith("/v1/oauth")) return PERMISSIONS.OAUTH;
  
  return undefined;
}

/**
 * Create auth middleware with API key service
 */
export function createAuthMiddleware(apiKeyService: ApiKeyService) {
  return async function authMiddleware(
    request: AuthenticatedRequest,
    reply: FastifyReply
  ): Promise<void> {
    // Check if this is an admin-only route (always requires auth)
    const isAdminRoute = isAdminOnlyRoute(request.url);
    
    // Skip auth if not required (except for admin routes)
    if (env.API_KEY_REQUIRED !== "true" && !isAdminRoute) {
      return;
    }

    // Skip auth for public routes
    if (isPublicRoute(request.url)) {
      return;
    }

    // Get Authorization header
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      reply.code(401).send({
        ok: false,
        error: "Unauthorized - Missing Authorization header",
        message: "This API requires Bearer token authentication. Use: Authorization: Bearer <api-key>"
      });
      return;
    }

    // Parse Bearer token
    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0]!.toLowerCase() !== "bearer") {
      reply.code(401).send({
        ok: false,
        error: "Unauthorized - Invalid Authorization format",
        message: "Use format: Authorization: Bearer <api-key>"
      });
      return;
    }

    const token = parts[1];
    if (!token) {
      reply.code(401).send({
        ok: false,
        error: "Unauthorized - Missing token"
      });
      return;
    }

    // Check if it's the master key from env
    if (env.API_KEY && token === env.API_KEY) {
      request.apiKey = token;
      request.apiKeyId = "master";
      request.apiKeyPermissions = [PERMISSIONS.ALL];
      request.isMasterKey = true;
      return;
    }

    // For admin-only routes, reject immediately if not master key
    if (isAdminOnlyRoute(request.url)) {
      reply.code(403).send({
        ok: false,
        error: "Forbidden - Admin access required",
        message: "This endpoint requires the master API key. Regular API keys cannot access RAG, API key management, or tool management endpoints."
      });
      return;
    }

    // Check if it's a managed key (for non-admin routes)
    const requiredPermission = getRequiredPermission(request.url);
    const validation = await apiKeyService.validateKey(token, requiredPermission);

    if (!validation.valid) {
      reply.code(401).send({
        ok: false,
        error: `Unauthorized - ${validation.error}`
      });
      return;
    }

    // Store key info in request
    if (validation.apiKey) {
      request.apiKey = token;
      request.apiKeyId = validation.apiKey.id;
      request.apiKeyPermissions = validation.apiKey.permissions;
      request.isMasterKey = false;
    }
  };
}

/**
 * Generate a secure random API key
 * Re-exported from utils/api-key.ts
 */
export function generateApiKey(): string {
  return genKey();
}

/**
 * Hash an API key
 * Re-exported from utils/api-key.ts
 */
export function hashKey(key: string): string {
  return hashApiKey(key);
}
