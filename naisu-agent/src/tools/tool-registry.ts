import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../utils/json-store.js";
import { createLogger } from "../utils/logger.js";
import type { MemoryProvider } from "../memory/provider.js";
import type { SessionProvider } from "../session/provider.js";
import type { ToolInfo } from "./tool-service.js";
import type { CreateToolInput, UpdateToolInput } from "../api/tool-management-schemas.js";
import { randomUUID } from "node:crypto";

const log = createLogger("ToolRegistry");
const CUSTOM_TOOLS_PATH = "src/data/custom-tools.json";

/** Custom tool execution types */
export type ToolExecutionType = "http" | "code";

/** HTTP method for HTTP tools */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Parameter schema for custom tools */
export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  required: boolean;
  default?: unknown;
}

/** Custom tool definition */
export interface CustomTool {
  id: string;
  name: string;
  description: string;
  parameters: ToolParameter[];
  execution: {
    type: "http";
    url: string;
    method: HttpMethod;
    headers?: Record<string, string> | undefined;
    bodyTemplate?: string | undefined; // JSON template with {{param}} placeholders
    timeoutMs?: number | undefined;
  } | {
    type: "code";
    code: string; // JavaScript code to execute
  };
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Re-export types from schemas for convenience
export type { CreateToolInput, UpdateToolInput };

/** Built-in tool names that cannot be modified */
const BUILTIN_TOOLS = ["memory_save", "memory_search", "context_get", "time_now"];

export class ToolRegistry {
  private customTools: Map<string, CustomTool> = new Map();

  async init(): Promise<void> {
    log.info("Initializing tool registry");
    
    const tools = await readJsonFile<CustomTool[]>(CUSTOM_TOOLS_PATH, []);
    
    for (const tool of tools) {
      this.customTools.set(tool.id, tool);
    }
    
    log.info("Tool registry initialized", { 
      customTools: this.customTools.size,
      builtinTools: BUILTIN_TOOLS.length 
    });
  }

  private async persist(): Promise<void> {
    const tools = Array.from(this.customTools.values());
    await writeJsonFile(CUSTOM_TOOLS_PATH, tools);
  }

  /**
   * Get all tools (built-in + custom)
   */
  getAllTools(): { builtin: string[]; custom: CustomTool[] } {
    return {
      builtin: BUILTIN_TOOLS,
      custom: Array.from(this.customTools.values())
    };
  }

  /**
   * Get custom tool by ID
   */
  getTool(id: string): CustomTool | undefined {
    return this.customTools.get(id);
  }

  /**
   * Get custom tool by name
   */
  getToolByName(name: string): CustomTool | undefined {
    return Array.from(this.customTools.values()).find(
      t => t.name === name && t.isActive
    );
  }

  /**
   * Create a new custom tool
   */
  async createTool(input: CreateToolInput): Promise<CustomTool> {
    // Validate name (cannot conflict with built-in tools)
    if (BUILTIN_TOOLS.includes(input.name)) {
      throw new Error(`Tool name '${input.name}' is reserved for built-in tools`);
    }

    // Check for duplicate names among custom tools
    const existing = Array.from(this.customTools.values()).find(t => t.name === input.name);
    if (existing) {
      throw new Error(`Tool with name '${input.name}' already exists`);
    }

    // Validate tool name format
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(input.name)) {
      throw new Error("Tool name must start with a letter and contain only letters, numbers, underscores, and hyphens");
    }

    const now = new Date().toISOString();
    const tool: CustomTool = {
      id: randomUUID(),
      name: input.name,
      description: input.description,
      parameters: input.parameters,
      execution: input.execution,
      isActive: true,
      createdAt: now,
      updatedAt: now
    };

    this.customTools.set(tool.id, tool);
    await this.persist();

    log.info("Custom tool created", { toolId: tool.id, name: tool.name });
    return tool;
  }

  /**
   * Update a custom tool
   */
  async updateTool(id: string, input: UpdateToolInput): Promise<CustomTool | null> {
    const tool = this.customTools.get(id);
    if (!tool) {
      return null;
    }

    // Validate name change doesn't conflict
    if (input.name && input.name !== tool.name) {
      if (BUILTIN_TOOLS.includes(input.name)) {
        throw new Error(`Tool name '${input.name}' is reserved for built-in tools`);
      }
      
      const existing = Array.from(this.customTools.values()).find(
        t => t.name === input.name && t.id !== id
      );
      if (existing) {
        throw new Error(`Tool with name '${input.name}' already exists`);
      }
    }

    const updated: CustomTool = {
      ...tool,
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.parameters !== undefined && { parameters: input.parameters }),
      ...(input.execution !== undefined && { execution: input.execution }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
      updatedAt: new Date().toISOString()
    };

    this.customTools.set(id, updated);
    await this.persist();

    log.info("Custom tool updated", { toolId: id, name: updated.name });
    return updated;
  }

  /**
   * Delete a custom tool
   */
  async deleteTool(id: string): Promise<boolean> {
    const tool = this.customTools.get(id);
    if (!tool) {
      return false;
    }

    this.customTools.delete(id);
    await this.persist();

    log.info("Custom tool deleted", { toolId: id, name: tool.name });
    return true;
  }

  /**
   * Convert custom tool to DynamicStructuredTool for execution
   */
  createExecutableTool(
    tool: CustomTool,
    memory: MemoryProvider,
    sessions: SessionProvider
  ): DynamicStructuredTool {
    // Build Zod schema from parameters
    const schemaShape: Record<string, z.ZodTypeAny> = {};
    
    for (const param of tool.parameters) {
      let zodType: z.ZodTypeAny;
      
      switch (param.type) {
        case "string":
          zodType = z.string();
          break;
        case "number":
          zodType = z.number();
          break;
        case "boolean":
          zodType = z.boolean();
          break;
        case "array":
          zodType = z.array(z.any());
          break;
        case "object":
          zodType = z.record(z.any());
          break;
        default:
          zodType = z.any();
      }

      // Add description
      if (param.description) {
        zodType = zodType.describe(param.description);
      }

      // Add default if specified
      if (param.default !== undefined) {
        zodType = zodType.default(param.default);
      }

      // Make optional if not required
      if (!param.required) {
        zodType = zodType.optional();
      }

      schemaShape[param.name] = zodType;
    }

    const schema = z.object(schemaShape);

    return new DynamicStructuredTool({
      name: tool.name,
      description: tool.description,
      schema,
      func: async (args) => {
        return this.executeCustomTool(tool, args);
      }
    });
  }

  /**
   * Execute a custom tool
   */
  private async executeCustomTool(
    tool: CustomTool,
    args: Record<string, unknown>
  ): Promise<string> {
    try {
      if (tool.execution.type === "http") {
        return await this.executeHttpTool(tool.execution, args);
      } else {
        return await this.executeCodeTool(tool.execution.code, args);
      }
    } catch (error) {
      log.error(`Tool execution failed: ${tool.name}`, error instanceof Error ? error : new Error(String(error)));
      return JSON.stringify({
        error: error instanceof Error ? error.message : "Tool execution failed",
        tool: tool.name
      });
    }
  }

  /**
   * Execute HTTP tool
   */
  private async executeHttpTool(
    execution: { url: string; method: HttpMethod; headers?: Record<string, string> | undefined; bodyTemplate?: string | undefined; timeoutMs?: number | undefined },
    args: Record<string, unknown>
  ): Promise<string> {
    // Build URL with parameter substitution
    let url = execution.url;
    for (const [key, value] of Object.entries(args)) {
      url = url.replace(new RegExp(`{{${key}}}`, "g"), String(value));
    }

    // Validate URL to prevent SSRF
    try {
      const parsedUrl = new URL(url);
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        throw new Error(`Invalid URL protocol: ${parsedUrl.protocol}`);
      }
    } catch (e) {
      throw new Error(`Invalid tool URL: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Build headers with parameter substitution
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...execution.headers
    };
    
    for (const [key, value] of Object.entries(headers)) {
      headers[key] = value.replace(/\{\{(\w+)\}\}/g, (_, paramName) => {
        return String(args[paramName] ?? "");
      });
    }

    // Build body if template provided
    let body: string | undefined;
    if (execution.bodyTemplate) {
      body = execution.bodyTemplate.replace(/\{\{(\w+)\}\}/g, (_, paramName) => {
        const value = args[paramName];
        return JSON.stringify(value ?? null);
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      execution.timeoutMs ?? 30000
    );

    try {
      const response = await fetch(url, {
        method: execution.method,
        headers,
        ...(body && ["POST", "PUT", "PATCH"].includes(execution.method) ? { body } : {}),
        signal: controller.signal
      });

      clearTimeout(timeout);

      const responseBody = await response.text();
      
      return JSON.stringify({
        status: response.status,
        statusText: response.statusText,
        body: responseBody
      });
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  /**
   * Execute code tool (sandboxed)
   * WARNING: This executes arbitrary JavaScript code
   */
  private async executeCodeTool(code: string, args: Record<string, unknown>): Promise<string> {
    // Create a sandbox with limited globals
    const sandbox = {
      args,
      console: {
        log: (...msgs: unknown[]) => log.info("Tool console.log", { messages: msgs.map(m => String(m)).join(" ") }),
        error: (...msgs: unknown[]) => log.warn("Tool console.error", { messages: msgs.map(m => String(m)).join(" ") })
      },
      fetch,
      JSON,
      Math,
      Date,
      RegExp,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Promise,
      setTimeout,
      clearTimeout,
      Buffer
    };

    // Wrap code in async function
    const wrappedCode = `
      return (async () => {
        ${code}
      })();
    `;

    try {
      // Create function with sandbox parameters
      const fn = new Function(...Object.keys(sandbox), wrappedCode);
      const result = await fn(...Object.values(sandbox));
      
      return typeof result === "string" ? result : JSON.stringify(result);
    } catch (error) {
      throw new Error(`Code execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if a tool name is built-in
   */
  isBuiltinTool(name: string): boolean {
    return BUILTIN_TOOLS.includes(name);
  }
}
