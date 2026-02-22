import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { env } from "./config/env.js";
import { AgentRuntime } from "./agent/runtime.js";
import { ChatRequestSchema, OAuthCallbackQuerySchema, ApiKeyCreateSchema } from "./api/schemas.js";
import { createMemoryProvider } from "./memory/factory.js";
import { createRetrieverProvider } from "./agent/retriever-factory.js";
import { createSessionProvider } from "./session/factory.js";
import { RAGStore } from "./rag/store.js";
import { RAGService } from "./rag/service.js";
import { RAGIngestSchema, RAGJobQuerySchema, RAGSearchSchema } from "./rag/schemas.js";
import { OAuthStore } from "./oauth/store.js";
import { OAuthService } from "./oauth/service.js";
import { isOAuthConfigured } from "./oauth/config.js";
import { ToolService } from "./tools/tool-service.js";
import { ToolRegistry } from "./tools/tool-registry.js";
import { ToolCallRequestSchema } from "./api/tool-schemas.js";
import { CreateToolSchema, UpdateToolSchema, ToolIdParamSchema, type CreateToolInput, type UpdateToolInput } from "./api/tool-management-schemas.js";
import { CreateProjectSchema, UpdateProjectSchema, ProjectIdParamSchema } from "./api/project-schemas.js";
import { CreateAgentSchema, UpdateAgentSchema, AgentIdParamSchema } from "./api/agent-schemas.js";
import { ProjectService } from "./projects/service.js";
import { AgentService } from "./agents/service.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { createRateLimitMiddleware, createRateLimitInfoMiddleware, skipIfAdmin, createSkipPathsMiddleware } from "./middleware/rate-limit.js";
import { createRateLimiter, getRateLimitConfig, isRateLimitingEnabled, getEndpointRateLimit } from "./rate-limiter/factory.js";
import { ApiKeyService } from "./api-key/service.js";
import { createLogger } from "./utils/logger.js";
import { parseFile, validateFile, formatFileSize } from "./utils/file-parser.js";

const log = createLogger("Server");

// Type for authenticated request
interface AuthRequest {
  isMasterKey?: boolean;
  apiKeyId?: string;
  apiKeyPermissions?: string[];
}

const app = Fastify({ 
  logger: {
    level: "info",
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true
      }
    }
  }
});

// Initialize services
log.info("Initializing services...");

const memory = createMemoryProvider();
const sessions = createSessionProvider();
const toolRegistry = new ToolRegistry();
const runtime = new AgentRuntime(memory, sessions, toolRegistry);
const ragStore = new RAGStore();
const rag = new RAGService(ragStore);
const oauthStore = new OAuthStore();
const oauthService = new OAuthService(oauthStore);
const toolService = new ToolService(memory, sessions);
const apiKeyService = new ApiKeyService();
const projectService = new ProjectService();
const agentService = new AgentService();

// Initialize rate limiter
const rateLimiter = createRateLimiter();
const rateLimitConfig = getRateLimitConfig();
const rateLimitEnabled = isRateLimitingEnabled();

// Register cookie plugin
await app.register(cookie, {
  secret: env.OAUTH_CLIENT_SECRET ?? "default-secret-change-in-production",
  parseOptions: {}
});

// Register CORS plugin
await app.register(cors, {
  origin: true, // Allow all origins in development, configure for production
  credentials: true, // Allow cookies
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Device-ID",
    "X-Requested-With"
  ],
  maxAge: 86400 // 24 hours
});

log.info("CORS enabled", { origin: "* (allow all)" });

// Register multipart plugin for file uploads
await app.register(multipart, {
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
    files: 1 // Max 1 file per request
  }
});

log.info("Multipart file upload enabled", { maxFileSize: "10MB" });

// Initialize stores
log.info("Initializing stores...");

await memory.init();
await sessions.init();
await ragStore.init();
await apiKeyService.init();
await toolRegistry.init();
await projectService.init();
await agentService.init();

// Initialize rate limiter if enabled
if (rateLimitEnabled) {
  await rateLimiter.init();
  log.info("Rate limiter initialized", { 
    backend: env.RATE_LIMIT_BACKEND ?? "json",
    maxRequests: rateLimitConfig.maxRequests,
    windowSeconds: rateLimitConfig.windowSeconds
  });
}

log.info("Stores initialized", {
  memoryBackend: env.MEMORY_BACKEND,
  sessionBackend: env.SESSION_BACKEND,
  activeApiKeys: apiKeyService.countActiveKeys(),
  rateLimitingEnabled: rateLimitEnabled,
  customTools: toolRegistry.getAllTools().custom.length,
  projects: projectService.getProjectCount(),
  agents: agentService.getAgentCount()
});

// Register auth middleware after apiKeyService is initialized
const authMiddleware = createAuthMiddleware(apiKeyService);
app.addHook("onRequest", authMiddleware);

// Register rate limiting middleware (after auth so we can check admin status)
if (rateLimitEnabled) {
  // Public endpoints with rate limiting (skip for admin requests)
  const chatRateLimit = getEndpointRateLimit("chat");
  const rateLimitMiddleware = createRateLimitMiddleware(rateLimiter, rateLimitConfig, {
    limit: chatRateLimit.limit,
    windowSeconds: chatRateLimit.windowSeconds,
    skip: skipIfAdmin
  });

  // Apply rate limiting to specific routes
  app.addHook("onRequest", async (request, reply) => {
    // Only apply to public routes that need rate limiting
    const publicRateLimitedPaths = ["/v1/chat", "/v1/tools/call"];
    const pathname = request.url.split("?")[0] ?? request.url;
    
    if (publicRateLimitedPaths.some(path => pathname === path)) {
      return rateLimitMiddleware(request, reply);
    }
  });

  log.info("Rate limiting enabled for public endpoints", {
    limit: chatRateLimit.limit,
    windowSeconds: chatRateLimit.windowSeconds
  });
}

// Add request logging hook
app.addHook("onRequest", async (request, reply) => {
  (request as any).startTime = Date.now();
  log.info(`Request: ${request.method} ${request.url}`, {
    method: request.method,
    url: request.url,
    ip: request.ip,
    userAgent: request.headers["user-agent"]
  });
});

// Add response logging hook
app.addHook("onSend", async (request, reply, payload) => {
  const startTime = (request as any).startTime || Date.now();
  const duration = Date.now() - startTime;
  const statusCode = reply.statusCode;
  
  const level = statusCode >= 400 ? "warn" : "info";
  const message = `Response: ${request.method} ${request.url} - Status: ${statusCode} - Duration: ${duration}ms`;
  
  if (level === "warn") {
    log.warn(message, { statusCode, durationMs: duration });
  } else {
    log.info(message, { statusCode, durationMs: duration });
  }
});

if (isOAuthConfigured()) {
  await oauthStore.init();
  log.info("OAuth initialized", { provider: env.OAUTH_PROVIDER });
}

// ===== Health Check =====
app.get("/health", async () => {
  log.debug("Health check requested");
  return {
    ok: true,
    service: "agent-infra-langchain-ts",
    llmProvider: env.LLM_PROVIDER,
    oauthEnabled: isOAuthConfigured(),
    apiKeyRequired: env.API_KEY_REQUIRED === "true",
    apiKeyConfigured: !!env.API_KEY,
    managedKeys: apiKeyService.countActiveKeys(),
    projects: projectService.getProjectCount(),
    agents: agentService.getAgentCount(),
    rateLimitingEnabled: rateLimitEnabled,
    rateLimitConfig: rateLimitEnabled ? {
      maxRequests: rateLimitConfig.maxRequests,
      windowSeconds: rateLimitConfig.windowSeconds
    } : undefined
  };
});

// ===== Rate Limit Info Endpoint (Public) =====
app.get("/v1/rate-limit", async (req, reply) => {
  log.debug("Rate limit info request");
  
  if (!rateLimitEnabled) {
    return {
      ok: true,
      rateLimitingEnabled: false,
      message: "Rate limiting is disabled"
    };
  }

  // Apply info middleware to set headers
  const infoMiddleware = createRateLimitInfoMiddleware(rateLimiter, rateLimitConfig);
  await infoMiddleware(req, reply);

  const rateLimitReq = req as typeof req & { rateLimit?: { allowed: boolean; remaining: number; resetAt: Date; limit: number } };

  if (!rateLimitReq.rateLimit) {
    return reply.code(500).send({ ok: false, error: "Failed to get rate limit info" });
  }

  return {
    ok: true,
    rateLimitingEnabled: true,
    limit: rateLimitReq.rateLimit.limit,
    remaining: rateLimitReq.rateLimit.remaining,
    resetAt: rateLimitReq.rateLimit.resetAt.toISOString(),
    resetInSeconds: Math.ceil((rateLimitReq.rateLimit.resetAt.getTime() - Date.now()) / 1000)
  };
});

// ===== API Key Management Routes (ADMIN ONLY) =====

// Helper to check if request is admin (master key)
function isAdmin(req: AuthRequest): boolean {
  return req.isMasterKey === true;
}

// List all API keys - ADMIN ONLY
app.get("/v1/keys", async (req, reply) => {
  log.info("List API keys request", { isMasterKey: (req as AuthRequest).isMasterKey });
  
  const authReq = req as AuthRequest;
  
  if (!isAdmin(authReq)) {
    log.warn("Unauthorized access attempt to list keys", { apiKeyId: authReq.apiKeyId });
    return reply.code(403).send({ 
      ok: false, 
      error: "Forbidden - Admin access required",
      message: "Only the master API key can manage API keys"
    });
  }

  const keys = await apiKeyService.listKeys();
  log.info("API keys listed", { count: keys.length });
  return { ok: true, keys };
});

// Create new API key - ADMIN ONLY
app.post("/v1/keys", async (req, reply) => {
  log.info("Create API key request");
  
  const authReq = req as AuthRequest;
  
  if (!isAdmin(authReq)) {
    log.warn("Unauthorized access attempt to create key", { apiKeyId: authReq.apiKeyId });
    return reply.code(403).send({ 
      ok: false, 
      error: "Forbidden - Admin access required",
      message: "Only the master API key can create API keys"
    });
  }
  
  const parsed = ApiKeyCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    log.warn("Invalid API key create request", { errors: parsed.error.flatten() });
    return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  }

  try {
    const input = {
      name: parsed.data.name,
      description: parsed.data.description ?? undefined,
      permissions: parsed.data.permissions ?? undefined,
      expiresInDays: parsed.data.expiresInDays ?? undefined
    };
    
    log.info("Creating API key", { name: input.name, permissions: input.permissions });
    
    const result = await apiKeyService.createKey(input, "master");
    
    log.info("API key created successfully", { 
      keyId: result.apiKey.id,
      keyPrefix: result.apiKey.keyPrefix 
    });
    
    return { 
      ok: true, 
      key: result.key,
      apiKey: {
        id: result.apiKey.id,
        keyPrefix: result.apiKey.keyPrefix,
        name: result.apiKey.name,
        description: result.apiKey.description,
        permissions: result.apiKey.permissions,
        createdAt: result.apiKey.createdAt,
        expiresAt: result.apiKey.expiresAt,
        isActive: result.apiKey.isActive
      }
    };
  } catch (error) {
    log.error("API key creation failed", error instanceof Error ? error : new Error(String(error)));
    return reply.code(500).send({ ok: false, error: "Failed to create API key" });
  }
});

// Revoke an API key - ADMIN ONLY
app.post("/v1/keys/:id/revoke", async (req, reply) => {
  const params = req.params as { id: string };
  log.info("Revoke API key request", { keyId: params.id });
  
  const authReq = req as AuthRequest;
  
  if (!isAdmin(authReq)) {
    log.warn("Unauthorized access attempt to revoke key", { keyId: params.id });
    return reply.code(403).send({ 
      ok: false, 
      error: "Forbidden - Admin access required",
      message: "Only the master API key can revoke API keys"
    });
  }

  const success = await apiKeyService.revokeKey(params.id);
  
  if (!success) {
    log.warn("API key not found for revoke", { keyId: params.id });
    return reply.code(404).send({ ok: false, error: "API key not found" });
  }
  
  log.info("API key revoked", { keyId: params.id });
  return { ok: true, message: "API key revoked" };
});

// Activate a revoked API key - ADMIN ONLY
app.post("/v1/keys/:id/activate", async (req, reply) => {
  const params = req.params as { id: string };
  log.info("Activate API key request", { keyId: params.id });
  
  const authReq = req as AuthRequest;
  
  if (!isAdmin(authReq)) {
    log.warn("Unauthorized access attempt to activate key", { keyId: params.id });
    return reply.code(403).send({ 
      ok: false, 
      error: "Forbidden - Admin access required",
      message: "Only the master API key can activate API keys"
    });
  }

  const success = await apiKeyService.activateKey(params.id);
  
  if (!success) {
    log.warn("API key not found for activate", { keyId: params.id });
    return reply.code(404).send({ ok: false, error: "API key not found" });
  }
  
  log.info("API key activated", { keyId: params.id });
  return { ok: true, message: "API key activated" };
});

// Delete an API key permanently - ADMIN ONLY
app.delete("/v1/keys/:id", async (req, reply) => {
  const params = req.params as { id: string };
  log.info("Delete API key request", { keyId: params.id });
  
  const authReq = req as AuthRequest;
  
  if (!isAdmin(authReq)) {
    log.warn("Unauthorized access attempt to delete key", { keyId: params.id });
    return reply.code(403).send({ 
      ok: false, 
      error: "Forbidden - Admin access required",
      message: "Only the master API key can delete API keys"
    });
  }

  const success = await apiKeyService.deleteKey(params.id);
  
  if (!success) {
    log.warn("API key not found for delete", { keyId: params.id });
    return reply.code(404).send({ ok: false, error: "API key not found" });
  }
  
  log.info("API key deleted", { keyId: params.id });
  return { ok: true, message: "API key deleted" };
});

// ===== OAuth Routes =====

app.get("/v1/oauth/login", async (req, reply) => {
  log.debug("OAuth login request");
  
  if (!oauthService.isEnabled()) {
    log.warn("OAuth login attempted but not configured");
    return reply.code(503).send({ 
      ok: false, 
      error: "OAuth is not configured. Set OAUTH_ENABLED=true and configure OAuth credentials." 
    });
  }

  try {
    const { redirectUrl } = req.query as { redirectUrl?: string };
    const { url, state } = await oauthService.generateAuthUrl(redirectUrl ?? "/");
    log.info("OAuth login URL generated", { redirectUrl });
    return { ok: true, url, state };
  } catch (error) {
    log.error("OAuth login failed", error instanceof Error ? error : new Error(String(error)));
    return reply.code(500).send({ ok: false, error: "Failed to generate OAuth URL" });
  }
});

app.get("/v1/oauth/callback", async (req, reply) => {
  log.debug("OAuth callback received");
  
  if (!oauthService.isEnabled()) {
    return reply.code(503).send({ ok: false, error: "OAuth is not configured" });
  }

  const parsed = OAuthCallbackQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    log.warn("Invalid OAuth callback", { errors: parsed.error.flatten() });
    return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  }

  try {
    const { session, redirectUrl } = await oauthService.handleCallback(
      parsed.data.code,
      parsed.data.state
    );
    
    log.info("OAuth callback successful", { userId: session.userId });
    
    return reply
      .setCookie("oauth_session", session.userId, {
        httpOnly: true,
        secure: env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 7 * 24 * 60 * 60 * 1000
      })
      .send({ 
        ok: true, 
        userId: session.userId,
        userInfo: session.userInfo,
        redirectUrl 
      });
  } catch (error) {
    log.error("OAuth callback failed", error instanceof Error ? error : new Error(String(error)));
    return reply.code(400).send({ 
      ok: false, 
      error: error instanceof Error ? error.message : "OAuth callback failed" 
    });
  }
});

app.get("/v1/oauth/session", async (req, reply) => {
  if (!oauthService.isEnabled()) {
    return reply.code(503).send({ ok: false, error: "OAuth is not configured" });
  }

  const sessionId = req.cookies?.oauth_session;
  if (!sessionId) {
    return reply.code(401).send({ ok: false, error: "Not authenticated" });
  }

  const session = await oauthService.validateSession(sessionId);
  if (!session) {
    return reply
      .clearCookie("oauth_session")
      .code(401)
      .send({ ok: false, error: "Session expired" });
  }

  return { 
    ok: true, 
    userId: session.userId,
    userInfo: session.userInfo,
    provider: session.provider
  };
});

app.post("/v1/oauth/logout", async (req, reply) => {
  const sessionId = req.cookies?.oauth_session;
  if (sessionId) {
    await oauthService.logout(sessionId);
    log.info("OAuth logout", { sessionId });
  }
  
  return reply
    .clearCookie("oauth_session")
    .send({ ok: true, message: "Logged out successfully" });
});

// ===== RAG Routes (ADMIN ONLY) =====

// Ingest document - ADMIN ONLY
app.post("/v1/rag/ingest", async (req, reply) => {
  log.info("RAG ingest request");
  
  const authReq = req as AuthRequest;
  
  if (!isAdmin(authReq)) {
    log.warn("Unauthorized RAG ingest attempt");
    return reply.code(403).send({ 
      ok: false, 
      error: "Forbidden - Admin access required",
      message: "Only the master API key can manage the knowledge base (RAG)"
    });
  }

  const parsed = RAGIngestSchema.safeParse(req.body);
  if (!parsed.success) {
    log.warn("Invalid RAG ingest request", { errors: parsed.error.flatten() });
    return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  }

  try {
    log.info("Ingesting document", { 
      tenantId: parsed.data.tenantId,
      source: parsed.data.source,
      contentLength: parsed.data.content.length
    });
    
    const result = await rag.ingest({
      tenantId: parsed.data.tenantId,
      source: parsed.data.source,
      content: parsed.data.content,
      ...(parsed.data.metadata ? { metadata: parsed.data.metadata } : {})
    });
    
    log.info("Document ingested", { jobId: result.jobId });
    return { ok: true, ...result };
  } catch (error) {
    log.error("RAG ingest failed", error instanceof Error ? error : new Error(String(error)));
    return reply.code(500).send({ ok: false, error: "RAG ingest failed" });
  }
});

// Get job status - ADMIN ONLY
app.get("/v1/rag/jobs/:jobId", async (req, reply) => {
  const authReq = req as AuthRequest;
  
  if (!isAdmin(authReq)) {
    return reply.code(403).send({ 
      ok: false, 
      error: "Forbidden - Admin access required",
      message: "Only the master API key can access RAG job status"
    });
  }

  const parsed = RAGJobQuerySchema.safeParse(req.params);
  if (!parsed.success) {
    return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  }

  const job = rag.getJob(parsed.data.jobId);
  if (!job) return reply.code(404).send({ ok: false, error: "Job not found" });
  return { ok: true, job };
});

// Upload and ingest file - ADMIN ONLY
app.post("/v1/rag/upload", async (req, reply) => {
  log.info("RAG file upload request");
  
  const authReq = req as AuthRequest;
  
  if (!isAdmin(authReq)) {
    log.warn("Unauthorized RAG upload attempt");
    return reply.code(403).send({ 
      ok: false, 
      error: "Forbidden - Admin access required",
      message: "Only the master API key can upload documents to the knowledge base"
    });
  }

  try {
    // Get uploaded file
    const data = await req.file();
    
    if (!data) {
      return reply.code(400).send({ 
        ok: false, 
        error: "No file uploaded" 
      });
    }

    const filename = data.filename;
    const mimetype = data.mimetype;
    
    log.info("File received", { filename, mimetype });

    // Read file buffer
    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // Validate file
    const validation = validateFile(filename, buffer.length);
    if (!validation.valid) {
      log.warn("File validation failed", { filename, error: validation.error });
      return reply.code(400).send({ 
        ok: false, 
        error: validation.error 
      });
    }

    // Parse file
    const parsed = await parseFile(buffer, filename);
    
    log.info("File parsed successfully", { 
      filename, 
      type: parsed.metadata.type,
      size: formatFileSize(parsed.metadata.size),
      wordCount: parsed.metadata.wordCount,
      pages: parsed.metadata.pages
    });

    // Get tenant ID from form field (default to 'default')
    const tenantIdField = data.fields?.tenantId;
    const tenantIdFieldValue = Array.isArray(tenantIdField) ? tenantIdField[0] : tenantIdField;
    const tenantId = (tenantIdFieldValue && "value" in tenantIdFieldValue ? tenantIdFieldValue.value : undefined) as string || "default";
    
    const metadataField = data.fields?.metadata;
    const metadataFieldValue = Array.isArray(metadataField) ? metadataField[0] : metadataField;
    const metadataStr = (metadataFieldValue && "value" in metadataFieldValue ? metadataFieldValue.value : undefined) as string || "{}";
    
    let metadata: Record<string, unknown> = {};
    try {
      metadata = JSON.parse(metadataStr);
    } catch {
      // Ignore invalid metadata JSON
    }

    // Ingest the parsed content
    const result = await rag.ingest({
      tenantId,
      source: filename,
      content: parsed.content,
      metadata: {
        ...metadata,
        originalFileName: filename,
        fileType: parsed.metadata.type,
        fileSize: parsed.metadata.size,
        wordCount: parsed.metadata.wordCount,
        pages: parsed.metadata.pages,
        uploadedAt: new Date().toISOString()
      }
    });
    
    log.info("Document uploaded and ingested", { 
      jobId: result.jobId,
      tenantId,
      filename 
    });
    
    return { 
      ok: true, 
      ...result,
      parsed: {
        filename,
        type: parsed.metadata.type,
        size: parsed.metadata.size,
        wordCount: parsed.metadata.wordCount,
        pages: parsed.metadata.pages
      }
    };
  } catch (error) {
    log.error("RAG file upload failed", error instanceof Error ? error : new Error(String(error)));
    return reply.code(500).send({ 
      ok: false, 
      error: error instanceof Error ? error.message : "File upload failed" 
    });
  }
});

// Search documents - ADMIN ONLY
app.get("/v1/rag/search", async (req, reply) => {
  const authReq = req as AuthRequest;
  
  if (!isAdmin(authReq)) {
    return reply.code(403).send({ 
      ok: false, 
      error: "Forbidden - Admin access required",
      message: "Only the master API key can search the knowledge base"
    });
  }

  const parsed = RAGSearchSchema.safeParse(req.query);
  if (!parsed.success) {
    return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  }

  const items = rag.query(parsed.data.tenantId, parsed.data.query, parsed.data.limit);
  return { ok: true, items };
});

// ===== Tool Routes =====

// List tools - Available to all authenticated users with 'tools' permission
app.get("/v1/tools", async () => {
  log.debug("List tools request");
  const tools = toolService.listTools();
  return { ok: true, tools };
});

// Execute tool - Available to all authenticated users with 'tools' permission
app.post("/v1/tools/call", async (req, reply) => {
  log.info("Tool call request");
  
  const parsed = ToolCallRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    log.warn("Invalid tool call request", { errors: parsed.error.flatten() });
    return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  }

  log.info(`Executing tool: ${parsed.data.toolName}`, { 
    userId: parsed.data.userId,
    args: parsed.data.args
  });

  try {
    const result = await toolService.executeTool(
      parsed.data.projectId,
      parsed.data.userId,
      parsed.data.sessionId,
      parsed.data.toolName,
      parsed.data.args
    );

    if (!result.success) {
      log.warn(`Tool execution failed: ${parsed.data.toolName}`, { error: result.error });
      return reply.code(400).send({ ok: false, error: result.error });
    }

    log.info(`Tool executed successfully: ${parsed.data.toolName}`);
    return { ok: true, result: result.result };
  } catch (error) {
    log.error(`Tool execution error: ${parsed.data.toolName}`, error instanceof Error ? error : new Error(String(error)));
    return reply.code(500).send({ ok: false, error: "Tool execution failed" });
  }
});

// ===== Admin Tool Management Routes (ADMIN ONLY) =====

// List all tools (built-in + custom) - ADMIN ONLY
app.get("/v1/admin/tools", async (req, reply) => {
  log.info("List all tools request");
  
  const authReq = req as AuthRequest;
  
  if (!isAdmin(authReq)) {
    log.warn("Unauthorized access attempt to list tools");
    return reply.code(403).send({ 
      ok: false, 
      error: "Forbidden - Admin access required",
      message: "Only the master API key can manage tools"
    });
  }

  const allTools = toolRegistry.getAllTools();
  
  // Get built-in tools with their info
  const builtinTools = allTools.builtin.map(name => {
    const tools = toolService.listTools();
    return tools.find(t => t.name === name);
  }).filter(Boolean);

  log.info("Tools listed", { 
    builtin: allTools.builtin.length, 
    custom: allTools.custom.length 
  });
  
  return { 
    ok: true, 
    tools: {
      builtin: builtinTools,
      custom: allTools.custom
    }
  };
});

// Get custom tool by ID - ADMIN ONLY
app.get("/v1/admin/tools/:id", async (req, reply) => {
  const params = req.params as { id: string };
  log.info("Get tool request", { toolId: params.id });
  
  const authReq = req as AuthRequest;
  
  if (!isAdmin(authReq)) {
    return reply.code(403).send({ 
      ok: false, 
      error: "Forbidden - Admin access required",
      message: "Only the master API key can view tool details"
    });
  }

  const parsed = ToolIdParamSchema.safeParse({ id: params.id });
  if (!parsed.success) {
    return reply.code(400).send({ ok: false, error: "Invalid tool ID" });
  }

  const tool = toolRegistry.getTool(parsed.data.id);
  if (!tool) {
    return reply.code(404).send({ ok: false, error: "Tool not found" });
  }

  return { ok: true, tool };
});

// Create new custom tool - ADMIN ONLY
app.post("/v1/admin/tools", async (req, reply) => {
  log.info("Create tool request");
  
  const authReq = req as AuthRequest;
  
  if (!isAdmin(authReq)) {
    log.warn("Unauthorized access attempt to create tool");
    return reply.code(403).send({ 
      ok: false, 
      error: "Forbidden - Admin access required",
      message: "Only the master API key can create tools"
    });
  }

  const parsed = CreateToolSchema.safeParse(req.body);
  if (!parsed.success) {
    log.warn("Invalid tool create request", { errors: parsed.error.flatten() });
    return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  }

  try {
    log.info("Creating custom tool", { 
      name: parsed.data.name,
      executionType: parsed.data.execution.type 
    });
    
    const tool = await toolRegistry.createTool(parsed.data);
    
    log.info("Custom tool created successfully", { 
      toolId: tool.id,
      name: tool.name 
    });
    
    return { 
      ok: true, 
      tool 
    };
  } catch (error) {
    log.error("Tool creation failed", error instanceof Error ? error : new Error(String(error)));
    return reply.code(400).send({ 
      ok: false, 
      error: error instanceof Error ? error.message : "Failed to create tool" 
    });
  }
});

// Update custom tool - ADMIN ONLY
app.put("/v1/admin/tools/:id", async (req, reply) => {
  const params = req.params as { id: string };
  log.info("Update tool request", { toolId: params.id });
  
  const authReq = req as AuthRequest;
  
  if (!isAdmin(authReq)) {
    log.warn("Unauthorized access attempt to update tool");
    return reply.code(403).send({ 
      ok: false, 
      error: "Forbidden - Admin access required",
      message: "Only the master API key can update tools"
    });
  }

  const idParsed = ToolIdParamSchema.safeParse({ id: params.id });
  if (!idParsed.success) {
    return reply.code(400).send({ ok: false, error: "Invalid tool ID" });
  }

  const bodyParsed = UpdateToolSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    log.warn("Invalid tool update request", { errors: bodyParsed.error.flatten() });
    return reply.code(400).send({ ok: false, error: bodyParsed.error.flatten() });
  }

  // Check if tool exists
  const existingTool = toolRegistry.getTool(idParsed.data.id);
  if (!existingTool) {
    return reply.code(404).send({ ok: false, error: "Tool not found" });
  }

  // Prevent modification of built-in tools
  if (toolRegistry.isBuiltinTool(existingTool.name)) {
    return reply.code(403).send({ 
      ok: false, 
      error: "Cannot modify built-in tool",
      message: "Built-in tools cannot be modified"
    });
  }

  try {
    const updated = await toolRegistry.updateTool(idParsed.data.id, bodyParsed.data);
    
    if (!updated) {
      return reply.code(404).send({ ok: false, error: "Tool not found" });
    }
    
    log.info("Custom tool updated successfully", { 
      toolId: updated.id,
      name: updated.name 
    });
    
    return { ok: true, tool: updated };
  } catch (error) {
    log.error("Tool update failed", error instanceof Error ? error : new Error(String(error)));
    return reply.code(400).send({ 
      ok: false, 
      error: error instanceof Error ? error.message : "Failed to update tool" 
    });
  }
});

// Delete custom tool - ADMIN ONLY
app.delete("/v1/admin/tools/:id", async (req, reply) => {
  const params = req.params as { id: string };
  log.info("Delete tool request", { toolId: params.id });
  
  const authReq = req as AuthRequest;
  
  if (!isAdmin(authReq)) {
    log.warn("Unauthorized access attempt to delete tool");
    return reply.code(403).send({ 
      ok: false, 
      error: "Forbidden - Admin access required",
      message: "Only the master API key can delete tools"
    });
  }

  const parsed = ToolIdParamSchema.safeParse({ id: params.id });
  if (!parsed.success) {
    return reply.code(400).send({ ok: false, error: "Invalid tool ID" });
  }

  // Check if tool exists
  const existingTool = toolRegistry.getTool(parsed.data.id);
  if (!existingTool) {
    return reply.code(404).send({ ok: false, error: "Tool not found" });
  }

  // Prevent deletion of built-in tools
  if (toolRegistry.isBuiltinTool(existingTool.name)) {
    return reply.code(403).send({ 
      ok: false, 
      error: "Cannot delete built-in tool",
      message: "Built-in tools cannot be deleted"
    });
  }

  const success = await toolRegistry.deleteTool(parsed.data.id);
  
  if (!success) {
    return reply.code(404).send({ ok: false, error: "Tool not found" });
  }
  
  log.info("Custom tool deleted successfully", { 
    toolId: parsed.data.id,
    name: existingTool.name 
  });
  
  return { ok: true, message: "Tool deleted successfully" };
});

// ===== Project Management Routes (ADMIN ONLY) =====

// List all projects - ADMIN ONLY
app.get("/v1/admin/projects", async (req, reply) => {
  log.info("List projects request");
  
  const authReq = req as AuthRequest;
  
  if (!isAdmin(authReq)) {
    log.warn("Unauthorized access attempt to list projects");
    return reply.code(403).send({ 
      ok: false, 
      error: "Forbidden - Admin access required",
      message: "Only the master API key can manage projects"
    });
  }

  const projects = projectService.listProjects();
  
  log.info("Projects listed", { count: projects.length });
  
  // Return projects without full character content for list view
  return { 
    ok: true, 
    projects: projects.map(p => ({
      id: p.id,
      name: p.name,
      apiKeyId: p.apiKeyId,
      keyPrefix: p.keyPrefix,
      description: p.description,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      isActive: p.isActive
    }))
  };
});

// Get project by ID - ADMIN ONLY
app.get("/v1/admin/projects/:id", async (req, reply) => {
  const params = req.params as { id: string };
  log.info("Get project request", { projectId: params.id });
  
  const authReq = req as AuthRequest;
  
  if (!isAdmin(authReq)) {
    return reply.code(403).send({ 
      ok: false, 
      error: "Forbidden - Admin access required",
      message: "Only the master API key can view project details"
    });
  }

  const parsed = ProjectIdParamSchema.safeParse({ id: params.id });
  if (!parsed.success) {
    return reply.code(400).send({ ok: false, error: "Invalid project ID" });
  }

  const project = projectService.getProject(parsed.data.id);
  if (!project) {
    return reply.code(404).send({ ok: false, error: "Project not found" });
  }

  return { ok: true, project };
});

// Get project character - ADMIN ONLY
app.get("/v1/admin/projects/:id/character", async (req, reply) => {
  const params = req.params as { id: string };
  log.info("Get project character request", { projectId: params.id });
  
  const authReq = req as AuthRequest;
  
  if (!isAdmin(authReq)) {
    return reply.code(403).send({ 
      ok: false, 
      error: "Forbidden - Admin access required",
      message: "Only the master API key can view project character"
    });
  }

  const parsed = ProjectIdParamSchema.safeParse({ id: params.id });
  if (!parsed.success) {
    return reply.code(400).send({ ok: false, error: "Invalid project ID" });
  }

  const character = projectService.getProjectCharacter(parsed.data.id);
  if (character === null) {
    return reply.code(404).send({ ok: false, error: "Project not found" });
  }

  return { ok: true, character };
});

// Create new project - ADMIN ONLY
app.post("/v1/admin/projects", async (req, reply) => {
  log.info("Create project request");
  
  const authReq = req as AuthRequest;
  
  if (!isAdmin(authReq)) {
    log.warn("Unauthorized access attempt to create project");
    return reply.code(403).send({ 
      ok: false, 
      error: "Forbidden - Admin access required",
      message: "Only the master API key can create projects"
    });
  }

  const parsed = CreateProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    log.warn("Invalid project create request", { errors: parsed.error.flatten() });
    return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  }

  try {
    log.info("Creating project", { name: parsed.data.name });
    
    // First create an API key for this project
    const apiKeyResult = await apiKeyService.createKey({
      name: `${parsed.data.name} API Key`,
      description: `Auto-generated API key for project: ${parsed.data.name}`,
      permissions: ["chat:write", "tools:read", "tools:execute"],
    }, "master");
    
    // Then create the project
    const { project } = await projectService.createProject(
      parsed.data,
      apiKeyResult.apiKey.id,
      apiKeyResult.apiKey.keyPrefix
    );
    
    log.info("Project created successfully", { 
      projectId: project.id,
      name: project.name,
      apiKeyId: apiKeyResult.apiKey.id
    });
    
    return { 
      ok: true, 
      project,
      apiKey: apiKeyResult.key // Return the full key (only time it's shown)
    };
  } catch (error) {
    log.error("Project creation failed", error instanceof Error ? error : new Error(String(error)));
    return reply.code(400).send({ 
      ok: false, 
      error: error instanceof Error ? error.message : "Failed to create project" 
    });
  }
});

// Update project - ADMIN ONLY
app.put("/v1/admin/projects/:id", async (req, reply) => {
  const params = req.params as { id: string };
  log.info("Update project request", { projectId: params.id });
  
  const authReq = req as AuthRequest;
  
  if (!isAdmin(authReq)) {
    log.warn("Unauthorized access attempt to update project");
    return reply.code(403).send({ 
      ok: false, 
      error: "Forbidden - Admin access required",
      message: "Only the master API key can update projects"
    });
  }

  const idParsed = ProjectIdParamSchema.safeParse({ id: params.id });
  if (!idParsed.success) {
    return reply.code(400).send({ ok: false, error: "Invalid project ID" });
  }

  const bodyParsed = UpdateProjectSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    log.warn("Invalid project update request", { errors: bodyParsed.error.flatten() });
    return reply.code(400).send({ ok: false, error: bodyParsed.error.flatten() });
  }

  try {
    const updated = await projectService.updateProject(idParsed.data.id, bodyParsed.data);
    
    if (!updated) {
      return reply.code(404).send({ ok: false, error: "Project not found" });
    }
    
    log.info("Project updated successfully", { 
      projectId: updated.id,
      name: updated.name 
    });
    
    return { ok: true, project: updated };
  } catch (error) {
    log.error("Project update failed", error instanceof Error ? error : new Error(String(error)));
    return reply.code(400).send({ 
      ok: false, 
      error: error instanceof Error ? error.message : "Failed to update project" 
    });
  }
});

// Delete project - ADMIN ONLY
app.delete("/v1/admin/projects/:id", async (req, reply) => {
  const params = req.params as { id: string };
  log.info("Delete project request", { projectId: params.id });
  
  const authReq = req as AuthRequest;
  
  if (!isAdmin(authReq)) {
    log.warn("Unauthorized access attempt to delete project");
    return reply.code(403).send({ 
      ok: false, 
      error: "Forbidden - Admin access required",
      message: "Only the master API key can delete projects"
    });
  }

  const parsed = ProjectIdParamSchema.safeParse({ id: params.id });
  if (!parsed.success) {
    return reply.code(400).send({ ok: false, error: "Invalid project ID" });
  }

  // Get project info before deleting for logging
  const project = projectService.getProject(parsed.data.id);
  if (!project) {
    return reply.code(404).send({ ok: false, error: "Project not found" });
  }

  const success = await projectService.deleteProject(parsed.data.id);
  
  if (!success) {
    return reply.code(404).send({ ok: false, error: "Project not found" });
  }
  
  // Also delete the associated API key
  if (project.apiKeyId) {
    await apiKeyService.deleteKey(project.apiKeyId);
  }
  
  // Also delete all agents associated with this project
  const deletedAgents = await agentService.deleteAgentsByProject(parsed.data.id);
  
  log.info("Project deleted successfully", { 
    projectId: parsed.data.id,
    name: project.name,
    deletedAgents
  });
  
  return { ok: true, message: "Project deleted successfully" };
});

// ===== Agent Management Routes (ADMIN ONLY) =====

// List all agents - ADMIN ONLY
app.get("/v1/admin/agents", async (req, reply) => {
  log.info("List agents request");
  
  const authReq = req as AuthRequest;
  
  if (!isAdmin(authReq)) {
    log.warn("Unauthorized access attempt to list agents");
    return reply.code(403).send({ 
      ok: false, 
      error: "Forbidden - Admin access required",
      message: "Only the master API key can manage agents"
    });
  }

  const { projectId } = req.query as { projectId?: string };
  const agents = agentService.listAgents(projectId);
  
  log.info("Agents listed", { count: agents.length, projectId });
  
  // Return agents without full character content for list view
  return { 
    ok: true, 
    agents: agents.map(a => ({
      id: a.id,
      name: a.name,
      description: a.description,
      projectId: a.projectId,
      role: a.role,
      model: a.model,
      isActive: a.isActive,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt
    }))
  };
});

// Get agent roles - ADMIN ONLY
app.get("/v1/admin/agents/roles", async (req, reply) => {
  log.info("Get agent roles request");
  
  const authReq = req as AuthRequest;
  
  if (!isAdmin(authReq)) {
    return reply.code(403).send({ 
      ok: false, 
      error: "Forbidden - Admin access required",
      message: "Only the master API key can view agent roles"
    });
  }

  const roles = agentService.getAvailableRoles();
  return { ok: true, roles };
});

// Get agent by ID - ADMIN ONLY
app.get("/v1/admin/agents/:id", async (req, reply) => {
  const params = req.params as { id: string };
  log.info("Get agent request", { agentId: params.id });
  
  const authReq = req as AuthRequest;
  
  if (!isAdmin(authReq)) {
    return reply.code(403).send({ 
      ok: false, 
      error: "Forbidden - Admin access required",
      message: "Only the master API key can view agent details"
    });
  }

  const parsed = AgentIdParamSchema.safeParse({ id: params.id });
  if (!parsed.success) {
    return reply.code(400).send({ ok: false, error: "Invalid agent ID" });
  }

  const agent = agentService.getAgent(parsed.data.id);
  if (!agent) {
    return reply.code(404).send({ ok: false, error: "Agent not found" });
  }

  return { ok: true, agent };
});

// Create new agent - ADMIN ONLY
app.post("/v1/admin/agents", async (req, reply) => {
  log.info("Create agent request");
  
  const authReq = req as AuthRequest;
  
  if (!isAdmin(authReq)) {
    log.warn("Unauthorized access attempt to create agent");
    return reply.code(403).send({ 
      ok: false, 
      error: "Forbidden - Admin access required",
      message: "Only the master API key can create agents"
    });
  }

  const parsed = CreateAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    log.warn("Invalid agent create request", { errors: parsed.error.flatten() });
    return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  }

  // Verify project exists
  if (!projectService.hasProject(parsed.data.projectId)) {
    return reply.code(400).send({ 
      ok: false, 
      error: "Project not found",
      message: `Project '${parsed.data.projectId}' does not exist`
    });
  }

  try {
    log.info("Creating agent", { 
      name: parsed.data.name, 
      projectId: parsed.data.projectId,
      role: parsed.data.role 
    });
    
    const agent = await agentService.createAgent(parsed.data);
    
    log.info("Agent created successfully", { 
      agentId: agent.id,
      name: agent.name,
      projectId: agent.projectId
    });
    
    return { 
      ok: true, 
      agent: {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        projectId: agent.projectId,
        role: agent.role,
        model: agent.model,
        isActive: agent.isActive,
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt
      }
    };
  } catch (error) {
    log.error("Agent creation failed", error instanceof Error ? error : new Error(String(error)));
    return reply.code(400).send({ 
      ok: false, 
      error: error instanceof Error ? error.message : "Failed to create agent" 
    });
  }
});

// Update agent - ADMIN ONLY
app.put("/v1/admin/agents/:id", async (req, reply) => {
  const params = req.params as { id: string };
  log.info("Update agent request", { agentId: params.id });
  
  const authReq = req as AuthRequest;
  
  if (!isAdmin(authReq)) {
    log.warn("Unauthorized access attempt to update agent");
    return reply.code(403).send({ 
      ok: false, 
      error: "Forbidden - Admin access required",
      message: "Only the master API key can update agents"
    });
  }

  const idParsed = AgentIdParamSchema.safeParse({ id: params.id });
  if (!idParsed.success) {
    return reply.code(400).send({ ok: false, error: "Invalid agent ID" });
  }

  const bodyParsed = UpdateAgentSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    log.warn("Invalid agent update request", { errors: bodyParsed.error.flatten() });
    return reply.code(400).send({ ok: false, error: bodyParsed.error.flatten() });
  }

  try {
    const updated = await agentService.updateAgent(idParsed.data.id, bodyParsed.data);
    
    if (!updated) {
      return reply.code(404).send({ ok: false, error: "Agent not found" });
    }
    
    log.info("Agent updated successfully", { 
      agentId: updated.id,
      name: updated.name 
    });
    
    return { ok: true, agent: updated };
  } catch (error) {
    log.error("Agent update failed", error instanceof Error ? error : new Error(String(error)));
    return reply.code(400).send({ 
      ok: false, 
      error: error instanceof Error ? error.message : "Failed to update agent" 
    });
  }
});

// Delete agent - ADMIN ONLY
app.delete("/v1/admin/agents/:id", async (req, reply) => {
  const params = req.params as { id: string };
  log.info("Delete agent request", { agentId: params.id });
  
  const authReq = req as AuthRequest;
  
  if (!isAdmin(authReq)) {
    log.warn("Unauthorized access attempt to delete agent");
    return reply.code(403).send({ 
      ok: false, 
      error: "Forbidden - Admin access required",
      message: "Only the master API key can delete agents"
    });
  }

  const parsed = AgentIdParamSchema.safeParse({ id: params.id });
  if (!parsed.success) {
    return reply.code(400).send({ ok: false, error: "Invalid agent ID" });
  }

  // Get agent info before deleting for logging
  const agent = agentService.getAgent(parsed.data.id);
  if (!agent) {
    return reply.code(404).send({ ok: false, error: "Agent not found" });
  }

  const success = await agentService.deleteAgent(parsed.data.id);
  
  if (!success) {
    return reply.code(404).send({ ok: false, error: "Agent not found" });
  }
  
  log.info("Agent deleted successfully", { 
    agentId: parsed.data.id,
    name: agent.name 
  });
  
  return { ok: true, message: "Agent deleted successfully" };
});

// ===== Public Chat Route (Rate Limited) =====

app.post("/v1/chat", async (req, reply) => {
  log.info("Chat request received (public)");
  
  const parsed = ChatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    log.warn("Invalid chat request", { errors: parsed.error.flatten() });
    return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  }

  try {
    log.info(`Chat message from user: ${parsed.data.userId}`, {
      messageLength: parsed.data.message.length,
      hasSessionId: !!parsed.data.sessionId
    });
    
    const result = await runtime.chat({
      projectId: parsed.data.projectId,
      userId: parsed.data.userId,
      message: parsed.data.message,
      ...(parsed.data.sessionId ? { sessionId: parsed.data.sessionId } : {})
    });
    
    log.info("Chat response sent successfully");
    return { ok: true, ...result };
  } catch (error) {
    log.error("Chat failed", error instanceof Error ? error : new Error(String(error)), {
      projectId: parsed.data.projectId,
      userId: parsed.data.userId,
      message: parsed.data.message.slice(0, 100)
    });
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return reply.code(500).send({ 
      ok: false, 
      error: "Internal server error",
      details: errorMessage
    });
  }
});

// ===== Admin Chat Route (No Rate Limit) =====

app.post("/v1/admin/chat", async (req, reply) => {
  log.info("Chat request received (admin)");
  
  const authReq = req as AuthRequest;
  
  // Only master key allowed for admin endpoint
  if (!isAdmin(authReq)) {
    log.warn("Unauthorized access attempt to admin chat", { apiKeyId: authReq.apiKeyId });
    return reply.code(403).send({ 
      ok: false, 
      error: "Forbidden - Admin access required",
      message: "Only the master API key can access admin endpoints"
    });
  }
  
  const parsed = ChatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    log.warn("Invalid admin chat request", { errors: parsed.error.flatten() });
    return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  }

  try {
    log.info(`Admin chat message from user: ${parsed.data.userId}`, {
      messageLength: parsed.data.message.length,
      hasSessionId: !!parsed.data.sessionId
    });
    
    const result = await runtime.chat({
      projectId: parsed.data.projectId,
      userId: parsed.data.userId,
      message: parsed.data.message,
      ...(parsed.data.sessionId ? { sessionId: parsed.data.sessionId } : {})
    });
    
    log.info("Admin chat response sent successfully");
    return { ok: true, ...result };
  } catch (error) {
    log.error("Admin chat failed", error instanceof Error ? error : new Error(String(error)), {
      projectId: parsed.data.projectId,
      userId: parsed.data.userId,
      message: parsed.data.message.slice(0, 100)
    });
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return reply.code(500).send({ 
      ok: false, 
      error: "Internal server error",
      details: errorMessage
    });
  }
});

// Start server
async function bootstrap() {
  log.info("Starting server...", {
    llmProvider: env.LLM_PROVIDER,
    model: env.MODEL,
    port: env.PORT,
    apiKeyRequired: env.API_KEY_REQUIRED,
    activeApiKeys: apiKeyService.countActiveKeys(),
    projects: projectService.getProjectCount(),
    agents: agentService.getAgentCount(),
    rateLimitingEnabled: rateLimitEnabled,
    rateLimitConfig: rateLimitEnabled ? {
      maxRequests: rateLimitConfig.maxRequests,
      windowSeconds: rateLimitConfig.windowSeconds
    } : undefined
  });
  
  if (isOAuthConfigured()) {
    log.info("OAuth enabled", { provider: env.OAUTH_PROVIDER });
  }
  
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  
  log.info(`Server started successfully on http://localhost:${env.PORT}`);
}

bootstrap().catch((error) => {
  log.error("Failed to start server", error);
  process.exit(1);
});
