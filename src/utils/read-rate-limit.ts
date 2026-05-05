import { Elysia } from "elysia"
import type { Env } from "@/types"

export function clientIp(headers: Record<string, string | undefined>): string {
	const xff = headers["x-forwarded-for"]
	if (xff) return xff.split(",")[0].trim()
	const real = headers["x-real-ip"]
	if (real) return real
	return "unknown"
}

export const readRateLimit = new Elysia({ name: "read-rate-limit" }).onBeforeHandle(
	{ as: "scoped" },
	async (ctx) => {
		const env = (ctx as unknown as { env: Env }).env
		const ip = clientIp(ctx.headers as Record<string, string | undefined>)
		const { success } = await env.READ_RATE_LIMITER.limit({ key: `ip:${ip}` })
		if (!success) {
			ctx.set.status = 429
			return { success: false, error: "Rate limited. Try again later." }
		}
	}
)
