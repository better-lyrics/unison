import { Elysia } from "elysia"
import { config } from "@/config"
import type { Env } from "@/types"
import { readRateLimit } from "@/utils/read-rate-limit"

const CHALLENGE_PREFIX = "challenge:"

function generateNonce(): string {
	const bytes = new Uint8Array(24)
	crypto.getRandomValues(bytes)
	let bin = ""
	for (const b of bytes) bin += String.fromCharCode(b)
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export const authRoutes = (env: Env) =>
	new Elysia({ prefix: "/auth" })
		.decorate("env", env)
		.use(readRateLimit)
		.get("/challenge", async ({ env }) => {
			const nonce = generateNonce()
			const ttl = config.auth.challenge.ttlSeconds
			await env.CACHE.put(`${CHALLENGE_PREFIX}${nonce}`, "1", { expirationTtl: ttl })
			const expiresAt = Math.floor(Date.now() / 1000) + ttl
			return { success: true, data: { nonce, expiresAt } }
		})
