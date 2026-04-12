import Redis from "ioredis";
import { env } from "@/env";

let redisClient: Redis | null = null;

export function initRedisClient(): void {
  if (redisClient) return;

  redisClient = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_AUTH_TOKEN || undefined,
    tls: env.REDIS_USE_TLS ? { rejectUnauthorized: false } : undefined,
    lazyConnect: false,
  });

  redisClient.on("error", (err) => console.error("Redis Client Error:", err));
  redisClient.on("connect", () =>
    console.log("✅ Connected to Redis/ElastiCache"),
  );
}

export function getRedisClient(): Redis {
  initRedisClient();
  if (!redisClient) {
    throw new Error(
      "Redis client not initialized. Call initRedisClient() first.",
    );
  }
  return redisClient;
}

export async function closeRedisClient(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    console.log("🔌 Redis connection closed");
  }
}

export const redis = getRedisClient();