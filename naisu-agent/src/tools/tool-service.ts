import type { MemoryProvider } from "../memory/provider.js";
import type { SessionProvider } from "../session/provider.js";
import { buildToolkit } from "./toolkit.js";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

export type ToolName = "memory_save" | "memory_search" | "context_get" | "time_now";

export interface ToolInfo {
  name: string;
  description: string;
  schema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// Get the inner type from a Zod schema (handling defaults, optionals, etc)
function unwrapZodType(schema: z.ZodTypeAny): { typeName: string; description: string | undefined; hasDefault: boolean } {
  let current = schema;
  let hasDefault = false;

  // Unwrap modifiers
  while (true) {
    const def = current._def as { typeName: string; innerType?: z.ZodTypeAny; defaultValue?: () => unknown };
    
    if (def.typeName === "ZodDefault") {
      hasDefault = true;
      current = def.innerType!;
    } else if (def.typeName === "ZodOptional" || def.typeName === "ZodNullable") {
      current = def.innerType!;
    } else {
      break;
    }
  }

  const def = current._def as { typeName: string; description?: string };
  return {
    typeName: def.typeName,
    description: def.description,
    hasDefault
  };
}

export class ToolService {
  constructor(
    private readonly memory: MemoryProvider,
    private readonly sessions: SessionProvider
  ) {}

  /**
   * List all available tools with their schemas
   */
  listTools(): ToolInfo[] {
    // Build a dummy toolkit to extract tool info
    const toolkit = buildToolkit({
      projectId: "dummy",
      userId: "dummy",
      sessionId: "dummy",
      memory: this.memory,
      sessions: this.sessions
    });

    return toolkit.map((tool) => {
      // Parse the Zod schema to extract field information
      const schema = tool.schema as z.ZodObject<Record<string, z.ZodTypeAny>>;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      // Get shape from ZodObject
      const shape = schema.shape;

      for (const [key, value] of Object.entries(shape)) {
        const unwrapped = unwrapZodType(value);

        properties[key] = {
          type: unwrapped.typeName === "ZodString" ? "string" : 
                unwrapped.typeName === "ZodNumber" ? "number" : 
                unwrapped.typeName === "ZodArray" ? "array" : 
                unwrapped.typeName === "ZodBoolean" ? "boolean" : "unknown",
          description: unwrapped.description
        };

        // If no default value, it's required
        if (!unwrapped.hasDefault) {
          required.push(key);
        }
      }

      return {
        name: tool.name,
        description: tool.description,
        schema: {
          type: "object",
          properties,
          required
        }
      };
    });
  }

  /**
   * Execute a tool directly by name
   */
  async executeTool(
    projectId: string,
    userId: string,
    sessionId: string | undefined,
    toolName: ToolName,
    args: Record<string, unknown>
  ): Promise<{ success: boolean; result: unknown; error?: string }> {
    // Ensure session exists
    const session = this.sessions.ensureSession(projectId, userId, sessionId);

    // Build toolkit with actual user/session context
    const toolkit = buildToolkit({
      projectId,
      userId,
      sessionId: session.id,
      memory: this.memory,
      sessions: this.sessions
    });

    // Find the tool
    const tool = toolkit.find((t) => t.name === toolName) as DynamicStructuredTool | undefined;
    if (!tool) {
      return { success: false, result: null, error: `Tool not found: ${toolName}` };
    }

    try {
      // Execute the tool
      const result = await tool.invoke(args);
      return { success: true, result };
    } catch (error) {
      return {
        success: false,
        result: null,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }
}
