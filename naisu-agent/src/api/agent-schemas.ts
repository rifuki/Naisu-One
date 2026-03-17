import { z } from "zod";

// Agent ID parameter
export const AgentIdParamSchema = z.object({
  id: z.string().min(1, "Agent ID is required"),
});

// Agent role enum
export const AgentRoleSchema = z.enum([
  "custom",
  "defi_expert",
  "support",
  "teacher",
  "analyst",
  "creative",
  "coder",
  "sales"
]);

// Create agent request
export const CreateAgentSchema = z.object({
  name: z.string().min(1, "Agent name is required").max(100, "Name too long"),
  description: z.string().max(500, "Description too long").optional(),
  projectId: z.string().min(1, "Project ID is required"),
  role: AgentRoleSchema.optional().default("custom"),
  character: z.string().optional(),
  model: z.string().optional(), // e.g., "gpt-4", "kimi-k2-turbo-preview"
});

// Update agent request
export const UpdateAgentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  role: AgentRoleSchema.optional(),
  character: z.string().optional(),
  model: z.string().optional(),
  isActive: z.boolean().optional(),
});

// Types
export type CreateAgentInput = z.infer<typeof CreateAgentSchema>;
export type UpdateAgentInput = z.infer<typeof UpdateAgentSchema>;
export type AgentRole = z.infer<typeof AgentRoleSchema>;
