import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { env } from "../config/env.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("LLM");

export type LLMProvider = "openai" | "kimi" | "heurist";

export type AnyLLM = ChatOpenAI | ChatAnthropic;

export interface LLMConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
  temperature?: number;
  timeout?: number;
  maxTokens?: number;
}

// Timeout for LLM requests (30 seconds)
const LLM_TIMEOUT = 30000;
// Maximum tokens to generate (keep responses concise and fast)
const MAX_TOKENS = 500;

export function createLLM(provider?: LLMProvider): AnyLLM {
  const selectedProvider = provider ?? env.LLM_PROVIDER;
  
  log.debug(`Creating LLM for provider: ${selectedProvider}`);
  
  if (selectedProvider === "kimi") {
    return createKimiLLM();
  }
  
  if (selectedProvider === "heurist") {
    return createHeuristLLM();
  }
  
  return createOpenAILLM();
}

export function createOpenAILLM(): ChatOpenAI {
  const config = {
    apiKey: env.OPENAI_API_KEY!,
    model: env.MODEL,
    temperature: env.MODEL.includes("kimi") ? 0.6 : 0.2,
    timeout: LLM_TIMEOUT,
    maxTokens: MAX_TOKENS,
    configuration: {} as { baseURL?: string; timeout?: number }
  };
  
  if (env.OPENAI_BASE_URL) {
    config.configuration.baseURL = env.OPENAI_BASE_URL;
  }
  
  log.info("Creating OpenAI LLM", { 
    model: config.model, 
    timeout: config.timeout,
    maxTokens: config.maxTokens 
  });
  
  return new ChatOpenAI(config);
}

export function createKimiLLM(): ChatAnthropic {
  const config = {
    apiKey: env.KIMI_API_KEY!,
    model: env.MODEL,
    temperature: 0.3,
    timeout: LLM_TIMEOUT,
    maxTokens: MAX_TOKENS,
    anthropicApiUrl: env.KIMI_BASE_URL,
  };
  
  log.info("Creating Kimi LLM (Anthropic-compatible)", { 
    model: config.model,
    baseURL: config.anthropicApiUrl,
    timeout: config.timeout,
    maxTokens: config.maxTokens 
  });
  
  return new ChatAnthropic(config);
}

export function createHeuristLLM(): ChatOpenAI {
  const config = {
    apiKey: env.HEURIST_API_KEY!,
    model: env.MODEL,
    temperature: 0.3,
    timeout: LLM_TIMEOUT,
    maxTokens: MAX_TOKENS,
    configuration: {
      baseURL: env.HEURIST_BASE_URL,
      timeout: LLM_TIMEOUT
    }
  };
  
  log.info("Creating Heurist LLM", { 
    model: config.model, 
    timeout: config.timeout,
    maxTokens: config.maxTokens 
  });
  
  return new ChatOpenAI(config);
}

export function getDefaultModel(provider?: LLMProvider): string {
  const selectedProvider = provider ?? env.LLM_PROVIDER;
  
  if (selectedProvider === "kimi") {
    return "kimi-k2-turbo-preview";
  }
  
  if (selectedProvider === "heurist") {
    return "hermes-3-llama3.1-8b";
  }
  
  return "gpt-4.1-mini";
}

export function getAvailableModels(provider?: LLMProvider): string[] {
  const selectedProvider = provider ?? env.LLM_PROVIDER;
  
  switch (selectedProvider) {
    case "kimi":
      return [
        "kimi-k2-turbo-preview",
        "kimi-k2-5",
        "kimi-k2"
      ];
    case "heurist":
      return [
        "hermes-3-llama3.1-8b",
        "mistralai/mixtral-8x7b-instruct",
        "meta-llama/llama-3-70b-instruct",
        "meta-llama/llama-3-8b-instruct"
      ];
    default:
      return [
        "gpt-4.1-mini",
        "gpt-4",
        "gpt-3.5-turbo"
      ];
  }
}
