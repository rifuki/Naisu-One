import { env } from "../config/env.js";
import { RedisSessionManager } from "./redis-session-manager.js";
import { SessionManager } from "./session-manager.js";
import type { SessionProvider } from "./provider.js";

export function createSessionProvider(): SessionProvider {
  if (env.SESSION_BACKEND === "redis") return new RedisSessionManager();
  return new SessionManager();
}
