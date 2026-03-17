import { z } from "zod";

export const ChatRequestSchema = z.object({
  projectId: z.string().min(1).default("default"),
  userId: z.string().min(1),
  sessionId: z.string().optional(),
  message: z.string().min(1),
  apiKey: z.string().optional().describe("Optional API key (alternative to Authorization header)")
});

// OAuth schemas
export const OAuthLoginSchema = z.object({
  redirectUrl: z.string().optional()
});

export const OAuthCallbackSchema = z.object({
  code: z.string(),
  state: z.string()
});

export const OAuthCallbackQuerySchema = z.object({
  code: z.string(),
  state: z.string()
});

// API Key management schemas
export const ApiKeyCreateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  permissions: z.array(z.string()).optional(),
  expiresInDays: z.number().int().positive().optional()
});

export const ApiKeyIdSchema = z.object({
  id: z.string().uuid()
});
