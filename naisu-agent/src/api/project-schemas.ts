import { z } from "zod";

// Project ID parameter
export const ProjectIdParamSchema = z.object({
  id: z.string().min(1, "Project ID is required"),
});

// Create project request
export const CreateProjectSchema = z.object({
  name: z.string().min(1, "Project name is required").max(100, "Name too long"),
  description: z.string().max(500, "Description too long").optional(),
  character: z.string().optional(),
});

// Update project request
export const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  character: z.string().optional(),
  isActive: z.boolean().optional(),
});

// Types
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;
