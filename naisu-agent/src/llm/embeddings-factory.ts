import { OpenAIEmbeddings } from "@langchain/openai";
import { env } from "../config/env.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Embeddings");

export type EmbeddingsProvider = "openai" | "kimi" | "heurist";

// Timeout for embeddings requests (10 seconds - faster than LLM)
const EMBEDDINGS_TIMEOUT = 10000;

/**
 * Create embeddings instance based on provider
 * All providers use OpenAI-compatible API
 */
export function createEmbeddings(provider?: EmbeddingsProvider): OpenAIEmbeddings {
  const selectedProvider = provider ?? env.LLM_PROVIDER;

  log.debug(`Creating embeddings for provider: ${selectedProvider}`);

  if (selectedProvider === "kimi") {
    return createKimiEmbeddings();
  }

  if (selectedProvider === "heurist") {
    return createHeuristEmbeddings();
  }

  return createOpenAIEmbeddings();
}

export function createOpenAIEmbeddings(): OpenAIEmbeddings {
  const config = {
    apiKey: env.OPENAI_API_KEY!,
    model: "text-embedding-3-small",
    configuration: {
      timeout: EMBEDDINGS_TIMEOUT
    } as { baseURL?: string; timeout: number }
  };

  if (env.OPENAI_BASE_URL) {
    config.configuration.baseURL = env.OPENAI_BASE_URL;
  }

  log.info("Creating OpenAI embeddings", { 
    model: config.model,
    timeout: config.configuration.timeout 
  });
  return new OpenAIEmbeddings(config);
}

export function createKimiEmbeddings(): OpenAIEmbeddings {
  const config = {
    apiKey: env.KIMI_API_KEY!,
    model: "text-embedding-v2",
    configuration: {
      baseURL: env.KIMI_BASE_URL,
      timeout: EMBEDDINGS_TIMEOUT
    }
  };

  log.info("Creating Kimi embeddings", { 
    model: config.model,
    timeout: config.configuration.timeout 
  });
  return new OpenAIEmbeddings(config);
}

export function createHeuristEmbeddings(): OpenAIEmbeddings {
  const config = {
    apiKey: env.HEURIST_API_KEY!,
    model: "BAAI/bge-large-en-v1.5",
    configuration: {
      baseURL: env.HEURIST_BASE_URL,
      timeout: EMBEDDINGS_TIMEOUT
    }
  };

  log.info("Creating Heurist embeddings", { 
    model: config.model,
    timeout: config.configuration.timeout 
  });
  return new OpenAIEmbeddings(config);
}

/**
 * Get default embedding model for provider
 */
export function getDefaultEmbeddingsModel(provider?: EmbeddingsProvider): string {
  const selectedProvider = provider ?? env.LLM_PROVIDER;

  switch (selectedProvider) {
    case "kimi":
      return "text-embedding-v2";
    case "heurist":
      return "BAAI/bge-large-en-v1.5";
    default:
      return "text-embedding-3-small";
  }
}

/**
 * Check if embeddings service is available with timeout
 * Returns true if embeddings should work
 */
export async function checkEmbeddingsHealth(): Promise<boolean> {
  const timeoutPromise = new Promise<boolean>((_, reject) => {
    setTimeout(() => reject(new Error("Embeddings health check timeout")), EMBEDDINGS_TIMEOUT);
  });
  
  const checkPromise = (async () => {
    try {
      const embeddings = createEmbeddings();
      // Try a simple embedding
      await embeddings.embedQuery("test");
      log.info("Embeddings health check passed");
      return true;
    } catch (error) {
      log.error("Embeddings health check failed", error as Error);
      return false;
    }
  })();

  try {
    return await Promise.race([checkPromise, timeoutPromise]);
  } catch (error) {
    log.error("Embeddings health check timed out", error as Error);
    return false;
  }
}
