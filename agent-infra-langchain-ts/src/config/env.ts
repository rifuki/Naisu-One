import "dotenv/config";
import { z } from "zod";

// Helper to handle empty strings as undefined for optional URL fields
const optionalUrl = () =>
  z
    .string()
    .optional()
    .transform((val) => (val === "" ? undefined : val))
    .pipe(z.string().url().optional());

const EnvSchema = z.object({
  // LLM Provider selection
  LLM_PROVIDER: z.enum(["openai", "kimi", "heurist"]).default("openai"),

  // OpenAI configuration
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: optionalUrl(),

  // Kimi configuration
  KIMI_API_KEY: z.string().optional(),
  KIMI_BASE_URL: z.string().url().default("https://api.moonshot.cn/v1"),

  // Heurist configuration
  HEURIST_API_KEY: z.string().optional(),
  HEURIST_BASE_URL: z.string().url().default("https://llm-gateway.heurist.xyz"),

  // OAuth configuration (for Kimi Code integration)
  OAUTH_ENABLED: z.enum(["true", "false"]).default("false"),
  OAUTH_CLIENT_ID: z.string().optional(),
  OAUTH_CLIENT_SECRET: z.string().optional(),
  OAUTH_REDIRECT_URI: optionalUrl(),
  OAUTH_PROVIDER: z.enum(["kimi", "custom"]).default("kimi"),
  OAUTH_AUTH_URL: optionalUrl(),
  OAUTH_TOKEN_URL: optionalUrl(),
  OAUTH_USERINFO_URL: optionalUrl(),

  // API Authentication
  API_KEY: z.string().optional(),
  API_KEY_REQUIRED: z.enum(["true", "false"]).default("false"),

  // Admin Dashboard Authentication
  ADMIN_USERNAME: z.string().default("admin"),
  ADMIN_PASSWORD: z.string().default("admin"),
  ADMIN_SESSION_SECRET: z.string().default("change-this-secret-in-production"),
  ADMIN_SESSION_MAX_AGE: z.coerce.number().default(24 * 60 * 60 * 1000), // 24 hours

  // Server configuration
  MODEL: z.string().default("gpt-4.1-mini"),
  PORT: z.coerce.number().default(8787),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Feature flags
  TOOL_POLICY_MODE: z.enum(["allow_all", "safe_only"]).default("safe_only"),
  MEMORY_BACKEND: z.enum(["local", "letta", "redis"]).default("local"),
  SESSION_BACKEND: z.enum(["local", "redis"]).default("local"),
  RAG_BACKEND: z.enum(["none", "llamaindex"]).default("none"),

  // Optional adapter configs
  LETTA_BASE_URL: optionalUrl(),
  LETTA_API_KEY: z.string().optional(),
  LLAMAINDEX_BASE_URL: optionalUrl(),
  LLAMAINDEX_API_KEY: z.string().optional(),
  REDIS_URL: z.string().optional(),
  REDIS_PREFIX: z.string().default("agentinfra"),

  // Naisu backend URL (for DeFi tools)
  NAISU_BACKEND_URL: z.string().url().default("http://localhost:3000"),

  // Rate Limiting Configuration
  RATE_LIMIT_ENABLED: z.enum(["true", "false"]).default("true"),
  RATE_LIMIT_BACKEND: z.enum(["json", "redis"]).default("json"),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(10),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().default(3600),
  RATE_LIMIT_DEVICE_HEADER: z.string().default("X-Device-ID"),
  RATE_LIMIT_TRUST_PROXY: z.enum(["true", "false"]).default("true"),
  // Per-endpoint overrides
  RATE_LIMIT_CHAT_MAX: z.coerce.number().optional(),
  RATE_LIMIT_CHAT_WINDOW: z.coerce.number().optional(),
  RATE_LIMIT_ADMIN_MAX: z.coerce.number().optional(),
  RATE_LIMIT_ADMIN_WINDOW: z.coerce.number().optional()
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid env:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

// Validate that required API keys are present based on provider
if (parsed.data.LLM_PROVIDER === "openai" && !parsed.data.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is required when LLM_PROVIDER=openai");
  process.exit(1);
}

if (parsed.data.LLM_PROVIDER === "kimi" && !parsed.data.KIMI_API_KEY) {
  console.error("KIMI_API_KEY is required when LLM_PROVIDER=kimi");
  process.exit(1);
}

if (parsed.data.LLM_PROVIDER === "heurist" && !parsed.data.HEURIST_API_KEY) {
  console.error("HEURIST_API_KEY is required when LLM_PROVIDER=heurist");
  process.exit(1);
}

export const env = parsed.data;
