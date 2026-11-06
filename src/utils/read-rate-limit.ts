import { config } from "@/config"
import type { Env } from "@/types"
import { isBlyricsApiRequest } from "@/utils/blyrics-api-auth"
import { Elysia } from "elysia"

export function clientIp(headers: Record<string, string | undefined>): string {
	const xff = headers["x-forwarded-for"]
	if (xff) return xff.split(",")[0].trim()
	const real = headers["x-real-ip"]
	if (real) return real
	return "unknown"
}

export function readBucket(headers: Record<string, string | undefined>): {
	key: string
	scale: number
} {
	const ip = clientIp(headers)
	return headers["sec-fetch-site"] === "same-origin"
		? { key: `spa:ip:${ip}`, scale: config.rateLimit.spaReadScale }
		: { key: `ip:${ip}`, scale: 1 }
}

export const readRateLimit = new Elysia({ name: "read-rate-limit" }).onBeforeHandle(
	{ as: "scoped" },
	async (ctx) => {
		const env = (ctx as unknown as { env: Env }).env
		const headers = ctx.headers as Record<string, string | undefined>
		if (isBlyricsApiRequest(headers, env)) return
		const { success } = await env.READ_RATE_LIMITER.limit(readBucket(headers))
		if (!success) {
			ctx.set.status = 429
			return { success: false, error: "Rate limited. Try again later." }
		}
	}
)
