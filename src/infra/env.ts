import { config } from "@/config"
import type { B2Config, Env } from "@/types"
import { Logger } from "./logger"
import { D1Compat, getPool } from "./database"
import { KVCompat, getRedis } from "./cache"
import { RedisRateLimiter } from "./rate-limiter"

const log = new Logger("env")
const DUMPS_ENABLED_TRUTHY = new Set(["true", "1", "yes"])

function readDumpsEnabled(): boolean {
	const raw = process.env.DUMPS_ENABLED?.trim().toLowerCase() ?? ""
	if (raw === "") return false
	const enabled = DUMPS_ENABLED_TRUTHY.has(raw)
	if (!enabled) {
		log.warn("DUMPS_ENABLED is set but did not normalize to a truthy value", {
			raw: process.env.DUMPS_ENABLED,
		})
	}
	return enabled
}

function readB2Config(): B2Config | null {
	const keyId = process.env.B2_KEY_ID
	const applicationKey = process.env.B2_APPLICATION_KEY
	const bucket = process.env.B2_BUCKET
	const endpoint = process.env.B2_ENDPOINT

	if (!keyId || !applicationKey || !bucket || !endpoint) return null

	return { keyId, applicationKey, bucket, endpoint }
}

function readDiscordOAuthConfig(): Env["DISCORD_OAUTH"] {
	const clientId = process.env.DISCORD_CLIENT_ID
	const clientSecret = process.env.DISCORD_CLIENT_SECRET
	const redirectUri = process.env.DISCORD_OAUTH_REDIRECT_URI

	if (!clientId || !clientSecret || !redirectUri) return null

	return { clientId, clientSecret, redirectUri }
}

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
		RATE_LIMITER: new RedisRateLimiter(
			redis,
			config.rateLimit.write.maxRequests,
			config.rateLimit.write.windowSeconds
		),
		READ_RATE_LIMITER: new RedisRateLimiter(
			redis,
			config.rateLimit.read.maxRequests,
			config.rateLimit.read.windowSeconds
		),
		CACHE_TTL_SECONDS: process.env.CACHE_TTL_SECONDS || "604800",
		DUMPS_ENABLED: readDumpsEnabled(),
		DUMP_PUBLIC_BASE_URL: process.env.DUMP_PUBLIC_BASE_URL || "",
		DUMP_DATABASE_URL: process.env.DUMP_DATABASE_URL || null,
		B2: readB2Config(),
		BUTLER_BOT_SECRET: process.env.BUTLER_BOT_SECRET || null,
		DISCORD_OAUTH: readDiscordOAuthConfig(),
	}
}
