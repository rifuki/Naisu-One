import { createClient, type RedisClientType } from "redis";
import { env } from "../config/env.js";

let client: RedisClientType | null = null;

export async function getRedisClient(): Promise<RedisClientType> {
  if (client?.isOpen) return client;

  if (!env.REDIS_URL) {
    throw new Error("REDIS_URL is required for redis backend");
  }

  client = createClient({ url: env.REDIS_URL });
  client.on("error", (error) => {
    console.error("Redis client error:", error);
  });

  await client.connect();
  return client;
}

export function redisKey(...parts: string[]): string {
  return [env.REDIS_PREFIX, ...parts].join(":");
}
