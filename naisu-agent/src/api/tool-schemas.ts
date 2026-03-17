import { z } from "zod";

export const ToolCallRequestSchema = z.object({
  projectId: z.string().min(1).default("default"),
  userId: z.string().min(1),
  sessionId: z.string().optional(),
  toolName: z.enum(["memory_save", "memory_search", "context_get", "time_now"]),
  args: z.record(z.unknown()).default({})
});

export const ToolListResponseSchema = z.object({
  ok: z.boolean(),
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      schema: z.object({
        type: z.string(),
        properties: z.record(z.unknown()),
        required: z.array(z.string()).optional()
      })
    })
  )
});
