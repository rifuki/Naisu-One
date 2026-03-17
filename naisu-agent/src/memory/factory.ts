import { env } from "../config/env.js";
import { LettaMemoryProvider } from "./letta-memory-provider.js";
import { LocalMemoryProvider } from "./local-memory-provider.js";
import type { MemoryProvider } from "./provider.js";
import { RedisMemoryProvider } from "./redis-memory-provider.js";

export function createMemoryProvider(): MemoryProvider {
  if (env.MEMORY_BACKEND === "letta") return new LettaMemoryProvider();
  if (env.MEMORY_BACKEND === "redis") return new RedisMemoryProvider();
  return new LocalMemoryProvider();
}
