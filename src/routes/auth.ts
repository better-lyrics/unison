import { Elysia } from "elysia"
import { config } from "@/config"
import type { Env } from "@/types"
import { signedRequest } from "@/utils/auth"
import { generatePetName } from "@/utils/petname"
import { readRateLimit } from "@/utils/read-rate-limit"
import { createSession } from "@/utils/session"

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
		.use(signedRequest)
		.post("/session", async (ctx) => {
			const env = ctx.env
			const signedPayload = (ctx as unknown as { signedPayload: Record<string, unknown> })
				.signedPayload
			const keyId = (ctx as unknown as { keyId: string }).keyId
			const signedOrigin = signedPayload.origin

			const requestOrigin = (ctx.headers as Record<string, string | undefined>)?.origin
			if (
				typeof signedOrigin !== "string" ||
				!requestOrigin ||
				requestOrigin !== signedOrigin
			) {
				ctx.set.status = 403
				return { success: false, error: "ORIGIN_MISMATCH" }
			}

			const nonce = signedPayload.nonce as string
			const challengeKey = `${CHALLENGE_PREFIX}${nonce}`
			const exists = await env.CACHE.get(challengeKey)
			if (!exists) {
				ctx.set.status = 401
				return { success: false, error: "CHALLENGE_INVALID" }
			}
			await env.CACHE.delete(challengeKey)

			const session = await createSession(env, keyId)
			return {
				success: true,
				data: {
					sessionToken: session.token,
					expiresAt: session.expiresAt,
					keyId,
					displayName: generatePetName(keyId),
				},
			}
		})
