import { HumanMessage, SystemMessage, AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { MemoryProvider } from "../memory/provider.js";
import type { SessionProvider } from "../session/provider.js";
import type { ToolRegistry } from "../tools/tool-registry.js";
import { createLLM } from "../llm/factory.js";
import { buildToolkit } from "../tools/toolkit.js";
import { createLogger } from "../utils/logger.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const log = createLogger("AgentRuntime");

export interface ChatInput {
  projectId: string;
  userId: string;
  sessionId?: string;
  message: string;
}

export interface ChatOutput {
  sessionId: string;
  message: string;
}

// Default system prompt as fallback
const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant with memory capabilities.
You have access to tools for saving and recalling memories.

When a user shares information about themselves:
- Use memory_save to store relevant facts, preferences, or context
- Tag memories with relevant keywords for better recall

When answering questions:
- Use memory_search to find relevant past information
- Use context_get to see recent conversation history
- Use time_now if the current time is relevant

Always be concise and helpful. Use tools proactively to provide better assistance.`;

/**
 * Load project-specific character/system prompt
 * Falls back to default if not found
 */
function loadProjectCharacter(projectId: string): string {
  try {
    // Try to load from projects/{projectId}.md
    const characterPath = resolve(`projects/${projectId}.md`);
    const content = readFileSync(characterPath, "utf-8");
    log.info(`Loaded character for project: ${projectId}`);
    return content;
  } catch {
    // Try to load from characters/{projectId}.md (alternative location)
    try {
      const characterPath = resolve(`characters/${projectId}.md`);
      const content = readFileSync(characterPath, "utf-8");
      log.info(`Loaded character from characters folder for project: ${projectId}`);
      return content;
    } catch {
      // Fall back to default
      log.info(`No character found for project: ${projectId}, using default`);
      return DEFAULT_SYSTEM_PROMPT;
    }
  }
}

// Max iterations: needs to be enough for full bridge flow:
// evm_balance → intent_quote → intent_build_tx → final response = 4 tool rounds
const MAX_ITERATIONS = 5;

export class AgentRuntime {
  private model = createLLM();

  constructor(
    private memory: MemoryProvider,
    private sessions: SessionProvider,
    private toolRegistry?: ToolRegistry
  ) {}

  async chat(input: ChatInput): Promise<ChatOutput> {
    const startTime = Date.now();
    log.info("Starting chat", { 
      projectId: input.projectId,
      userId: input.userId, 
      sessionId: input.sessionId 
    });

    // Load project-specific character
    const systemPrompt = loadProjectCharacter(input.projectId);

    // Get or create session with project context
    const session = this.sessions.ensureSession(input.projectId, input.userId, input.sessionId);
    log.debug("Session ready", { sessionId: session.id, projectId: input.projectId });

    // Build toolkit with project context
    const toolkit = buildToolkit({
      projectId: input.projectId,
      userId: input.userId,
      sessionId: session.id,
      memory: this.memory,
      sessions: this.sessions,
      ...(this.toolRegistry ? { toolRegistry: this.toolRegistry } : {})
    });
    const toolMap = new Map(toolkit.map((t) => [t.name, t]));

    // Bind tools to model
    const model = this.model.bindTools(toolkit);
    log.debug("Tools bound", { toolCount: toolkit.length });

    // Build message context
    const messages: BaseMessage[] = [
      new SystemMessage(systemPrompt),
      ...session.messages.map((m) =>
        m.role === "user"
          ? new HumanMessage(m.content)
          : new AIMessage(m.content)
      ),
      new HumanMessage(input.message)
    ];

    // Track tool execution times
    const toolTimings: Array<{ tool: string; duration: number }> = [];
    
    let answer = "";
    let iterations = 0;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      iterations++;
      const iterStart = Date.now();
      log.debug(`Iteration ${i + 1}/${MAX_ITERATIONS}`);

      // Invoke LLM
      const llmStart = Date.now();
      log.info(`Invoking LLM (iteration ${i + 1})`);
      
      let ai: AIMessage;
      try {
        ai = await model.invoke(messages);
      } catch (error) {
        log.error("LLM invocation failed", error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
      
      const llmDuration = Date.now() - llmStart;
      log.info(`LLM responded in ${llmDuration}ms`);

      // Add AI response to messages
      messages.push(ai);

      // If no tool calls, we have the final answer
      if (!ai.tool_calls || ai.tool_calls.length === 0) {
        answer = typeof ai.content === "string" ? ai.content : JSON.stringify(ai.content);
        log.debug("No tool calls, got final answer");
        break;
      }

      // Process tool calls
      log.debug(`Processing ${ai.tool_calls.length} tool calls`);
      
      for (const call of ai.tool_calls) {
        const toolName = call.name;
        const tool = toolMap.get(toolName);

        if (!tool) {
          log.warn(`Tool not found: ${toolName}`);
          messages.push(
            new ToolMessage({
              tool_call_id: call.id ?? "unknown",
              content: `Error: Tool "${toolName}" not found.`
            })
          );
          continue;
        }

        const toolStart = Date.now();
        log.info(`Executing tool: ${toolName}`, { args: call.args });

        try {
          const result = await (tool as any).invoke(call.args ?? {});
          const toolDuration = Date.now() - toolStart;
          toolTimings.push({ tool: toolName, duration: toolDuration });
          log.info(`Tool ${toolName} completed in ${toolDuration}ms`);

          const resultText = typeof result === "string" ? result : JSON.stringify(result);
          messages.push(
            new ToolMessage({
              tool_call_id: call.id ?? "unknown",
              content: resultText
            })
          );
        } catch (error) {
          const toolDuration = Date.now() - toolStart;
          log.error(`Tool ${toolName} failed after ${toolDuration}ms`, error instanceof Error ? error : new Error(String(error)));
          
          messages.push(
            new ToolMessage({
              tool_call_id: call.id ?? "unknown",
              content: `Error: Tool "${toolName}" failed - ${error instanceof Error ? error.message : "Unknown error"}`
            })
          );
        }
      }

      const iterDuration = Date.now() - iterStart;
      log.debug(`Iteration ${i + 1} completed in ${iterDuration}ms`);
    }

    // Save user message and assistant response to session using append method
    const finalAnswer = answer || "Acknowledged.";
    await this.sessions.append(session.id, "user", input.message);
    await this.sessions.append(session.id, "assistant", finalAnswer);

    const totalDuration = Date.now() - startTime;
    log.info("Chat completed", {
      totalDurationMs: totalDuration,
      iterations,
      toolTimings,
      sessionId: session.id,
      projectId: input.projectId
    });

    return {
      sessionId: session.id,
      message: finalAnswer
    };
  }
}
