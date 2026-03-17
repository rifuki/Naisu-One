import { env } from "../config/env.js";

const SAFE_TOOLS = new Set(["memory_save", "memory_search", "context_get", "time_now"]);

export function isToolAllowed(toolName: string): boolean {
  if (env.TOOL_POLICY_MODE === "allow_all") return true;
  return SAFE_TOOLS.has(toolName);
}

export function deniedToolMessage(toolName: string): string {
  return `Tool '${toolName}' is blocked by policy mode '${env.TOOL_POLICY_MODE}'.`;
}
