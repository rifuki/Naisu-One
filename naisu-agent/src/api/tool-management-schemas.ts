import { z } from "zod";

/** Tool parameter schema */
export const ToolParameterSchema = z.object({
  name: z.string().min(1, "Parameter name is required"),
  type: z.enum(["string", "number", "boolean", "array", "object"]),
  description: z.string().min(1, "Parameter description is required"),
  required: z.boolean().default(true),
  default: z.any().optional()
});

/** HTTP execution configuration */
export const HttpExecutionSchema = z.object({
  type: z.literal("http"),
  url: z.string().url("Valid URL is required"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  headers: z.record(z.string()).optional(),
  bodyTemplate: z.string().optional(),
  timeoutMs: z.number().int().positive().max(60000).default(30000)
});

/** Code execution configuration */
export const CodeExecutionSchema = z.object({
  type: z.literal("code"),
  code: z.string().min(1, "Code is required")
});

/** Create tool request schema */
export const CreateToolSchema = z.object({
  name: z.string()
    .min(1, "Tool name is required")
    .max(64, "Tool name too long")
    .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, "Tool name must start with a letter and contain only letters, numbers, underscores, and hyphens"),
  description: z.string().min(1, "Description is required").max(1000),
  parameters: z.array(ToolParameterSchema).default([]),
  execution: z.union([HttpExecutionSchema, CodeExecutionSchema])
});

/** Update tool request schema */
export const UpdateToolSchema = z.object({
  name: z.string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/)
    .optional(),
  description: z.string().min(1).max(1000).optional(),
  parameters: z.array(ToolParameterSchema).optional(),
  execution: z.union([HttpExecutionSchema, CodeExecutionSchema]).optional(),
  isActive: z.boolean().optional()
});

/** Tool ID parameter schema */
export const ToolIdParamSchema = z.object({
  id: z.string().uuid("Invalid tool ID")
});

// Export inferred types for use in server
export type CreateToolInput = z.infer<typeof CreateToolSchema>;
export type UpdateToolInput = z.infer<typeof UpdateToolSchema>;
