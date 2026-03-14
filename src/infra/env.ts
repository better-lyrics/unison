import type { Env } from "@/types"
import { D1Compat, getPool } from "./database"
import { KVCompat, getRedis } from "./cache"
import { RedisRateLimiter } from "./rate-limiter"

export function createEnv(): Env {
	const databaseUrl = process.env.DATABASE_URL
	if (!databaseUrl) throw new Error("DATABASE_URL is required")

	const redisUrl = process.env.REDIS_URL
	if (!redisUrl) throw new Error("REDIS_URL is required")

	const pool = getPool(databaseUrl)
	const redis = getRedis(redisUrl)

	return {
		DB: new D1Compat(pool),
		CACHE: new KVCompat(redis),
		RATE_LIMITER: new RedisRateLimiter(redis),
		CACHE_TTL_SECONDS: process.env.CACHE_TTL_SECONDS || "604800",
	}
}
