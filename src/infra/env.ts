import { config } from "@/config"
import { type JevGate, createTypesafeJevGate, disabledJevGate } from "@/services/jev-gate"
import { type TypesafeClient, createTypesafeClient } from "@/services/typesafe"
import type { B2Config, Env } from "@/types"
import { KVCompat, getRedis } from "./cache"
import { D1Compat, getPool } from "./database"
import { Logger } from "./logger"
import { RedisRateLimiter } from "./rate-limiter"
import { createStorage } from "./storage"

const log = new Logger("env")
const BOOL_ENV_TRUTHY = new Set(["true", "1", "yes"])
const BOOL_ENV_FALSY = new Set(["false", "0", "no"])

function readFlag(name: string): boolean {
	const raw = process.env[name]?.trim().toLowerCase() ?? ""
	if (raw === "") return false
	const enabled = BOOL_ENV_TRUTHY.has(raw)
	if (!enabled) {
		log.warn(`${name} is set but did not normalize to a truthy value`, {
			raw: process.env[name],
		})
	}
	return enabled
}

export function readTranslationProxyEnabled(): boolean {
	const raw = process.env.TRANSLATION_PROXY_DISABLED?.trim().toLowerCase() ?? ""
	if (raw === "") return true
	const disabled = BOOL_ENV_TRUTHY.has(raw)
	if (!disabled) {
		log.warn("TRANSLATION_PROXY_DISABLED is set but did not normalize to a truthy value", {
			raw: process.env.TRANSLATION_PROXY_DISABLED,
		})
	}
	return !disabled
}

function readB2Config(): B2Config | null {
	const keyId = process.env.B2_KEY_ID
	const applicationKey = process.env.B2_APPLICATION_KEY
	const bucket = process.env.B2_BUCKET
	const endpoint = process.env.B2_ENDPOINT

	if (!keyId || !applicationKey || !bucket || !endpoint) return null

	return { keyId, applicationKey, bucket, endpoint }
}

function readR2Config(): B2Config | null {
	const keyId = process.env.R2_ACCESS_KEY_ID
	const applicationKey = process.env.R2_SECRET_ACCESS_KEY
	const bucket = process.env.R2_BUCKET
	const endpoint = process.env.R2_ENDPOINT

	if (!keyId || !applicationKey || !bucket || !endpoint) return null

	return { keyId, applicationKey, bucket, endpoint, region: "auto" }
}

function readDiscordOAuthConfig(): Env["DISCORD_OAUTH"] {
	const clientId = process.env.DISCORD_CLIENT_ID
	const clientSecret = process.env.DISCORD_CLIENT_SECRET
	const redirectUri = process.env.DISCORD_OAUTH_REDIRECT_URI

	if (!clientId || !clientSecret || !redirectUri) return null

	return { clientId, clientSecret, redirectUri }
}

function readTypesafeApiKey(): string | undefined {
	return process.env.TYPESAFE_API_KEY?.trim() || undefined
}

export function readJevGate(): JevGate {
	const apiKey = readTypesafeApiKey()
	return apiKey ? createTypesafeJevGate({ apiKey }) : disabledJevGate
}

export function readTypesafeClient(): TypesafeClient | null {
	const apiKey = readTypesafeApiKey()
	return apiKey ? createTypesafeClient({ apiKey }) : null
}

export function readRecordingMatchEnabled(): boolean {
	const raw = process.env.RECORDING_MATCH_ENABLED?.trim().toLowerCase() ?? ""
	if (raw === "" || BOOL_ENV_TRUTHY.has(raw)) return true
	if (BOOL_ENV_FALSY.has(raw)) return false
	log.warn("RECORDING_MATCH_ENABLED is set but did not normalize to true or false", {
		raw: process.env.RECORDING_MATCH_ENABLED,
	})
	return false
}

function readBlyricsApiInvalidate(): Env["BLYRICS_API_INVALIDATE"] {
	const url = process.env.BLYRICS_API_INVALIDATE_URL?.trim()
	const secret = process.env.BLYRICS_API_INVALIDATE_SECRET?.trim()
	if (!url || !secret) return null
	return { url, secret }
}

export function createEnv(): Env {
	const databaseUrl = process.env.DATABASE_URL
	if (!databaseUrl) throw new Error("DATABASE_URL is required")

	const redisUrl = process.env.REDIS_URL
	if (!redisUrl) throw new Error("REDIS_URL is required")

	const pool = getPool(databaseUrl)
	const redis = getRedis(redisUrl)
	const unlimited = readFlag("RATE_LIMITS_DISABLED")
	const limiter = ({ maxRequests, windowSeconds }: { maxRequests: number; windowSeconds: number }) =>
		new RedisRateLimiter(redis, unlimited ? Number.MAX_SAFE_INTEGER : maxRequests, windowSeconds)

	return {
		DB: new D1Compat(pool),
		CACHE: new KVCompat(redis),
		RATE_LIMITER: limiter(config.rateLimit.write),
		READ_RATE_LIMITER: limiter(config.rateLimit.read),
		CACHE_TTL_SECONDS: process.env.CACHE_TTL_SECONDS || "604800",
		DUMPS_ENABLED: readFlag("DUMPS_ENABLED"),
		DUMP_PUBLIC_BASE_URL: process.env.DUMP_PUBLIC_BASE_URL || "",
		DUMP_DATABASE_URL: process.env.DUMP_DATABASE_URL || null,
		B2: readB2Config(),
		CDN: createStorage(readR2Config()),
		BUTLER_BOT_SECRET: process.env.BUTLER_BOT_SECRET || null,
		ADMIN_SECRET: process.env.ADMIN_SECRET || null,
		DISCORD_OAUTH: readDiscordOAuthConfig(),
		EXAM_DEV_ENABLED: readFlag("EXAM_DEV_ENABLED"),
		EXAM_BASE_URL: process.env.EXAM_BASE_URL || "",
		RAILWAY_PUBLIC_DOMAIN: process.env.RAILWAY_PUBLIC_DOMAIN || "",
		JEV: readJevGate(),
		TYPESAFE: readTypesafeClient(),
		RECORDING_MATCH_ENABLED: readRecordingMatchEnabled(),
		BLYRICS_API_INVALIDATE: readBlyricsApiInvalidate(),
		BLYRICS_API_KEY: process.env.BLYRICS_API_KEY?.trim() || null,
		BINILINK_LOOKUP_ENABLED: readFlag("BINILINK_LOOKUP_ENABLED"),
	}
}
