import { Elysia } from "elysia"
import { config } from "@/config"
import type { Env } from "@/types"
import { signedRequest } from "@/utils/auth"
import { generatePetName } from "@/utils/petname"
import { readRateLimit } from "@/utils/read-rate-limit"
import { createSession, deleteSession, getSession } from "@/utils/session"

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
		.post("/logout", async ({ env, headers, set }) => {
			const auth = headers.authorization
			const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null
			if (!token) {
				set.status = 401
				return { success: false, error: "MISSING_TOKEN" }
			}
			await deleteSession(env, token)
			return { success: true, data: { revoked: true } }
		})
		.get("/me", async ({ env, headers, set }) => {
			const auth = headers.authorization
			const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null
			if (!token) {
				set.status = 401
				return { success: false, error: "MISSING_TOKEN" }
			}
			const record = await getSession(env, token)
			if (!record) {
				set.status = 401
				return { success: false, error: "INVALID_TOKEN" }
			}
			return {
				success: true,
				data: {
					keyId: record.keyId,
					displayName: generatePetName(record.keyId),
					expiresAt: record.expiresAt,
				},
			}
		})
		.use(signedRequest)
		.post("/session", async ({ env, keyId, signedPayload, headers, set }) => {
			const signedOrigin = signedPayload.origin
			const requestOrigin = headers.origin
			if (typeof signedOrigin !== "string" || !requestOrigin || requestOrigin !== signedOrigin) {
				set.status = 403
				return { success: false, error: "ORIGIN_MISMATCH" }
			}

			const challengeKey = `${CHALLENGE_PREFIX}${signedPayload.nonce}`
			const claimed = await env.CACHE.getDel(challengeKey)
			if (!claimed) {
				set.status = 401
				return { success: false, error: "CHALLENGE_INVALID" }
			}

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
