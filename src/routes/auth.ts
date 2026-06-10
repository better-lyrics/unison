import { Elysia } from "elysia"
import { config } from "@/config"
import { clearNickname, resolveDisplayName, setNickname } from "@/db/users"
import type { Env } from "@/types"
import { signedRequest } from "@/utils/auth"
import { eitherAuth } from "@/utils/either-auth"
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
					displayName: await resolveDisplayName(env, record.keyId),
					expiresAt: record.expiresAt,
				},
			}
		})
		.use(
			new Elysia()
				.decorate("env", env)
				.use(eitherAuth)
				.post("/nickname/check", async ({ env, keyId, body, set }) => {
					const { success } = await env.RATE_LIMITER.limit({
						key: `nickname_check:${keyId}`,
						maxRequests: config.auth.nickname.check.maxRequests,
						windowSeconds: config.auth.nickname.check.windowSeconds,
					})
					if (!success) {
						set.status = 429
						return { success: false, error: "RATE_LIMITED" }
					}

					const raw = (body as { nickname?: unknown }).nickname
					const name = typeof raw === "string" ? raw : ""
					if (!new RegExp(config.auth.nickname.pattern).test(name)) {
						return { success: true, data: { available: false, reason: "INVALID_FORMAT" } }
					}

					const row = await env.DB.prepare("SELECT key_id FROM users WHERE nickname_lower = ?")
						.bind(name.toLowerCase())
						.first<{ key_id: string }>()

					if (!row) return { success: true, data: { available: true } }
					if (row.key_id === keyId) {
						return { success: true, data: { available: true, reason: "SELF" } }
					}
					return { success: true, data: { available: false, reason: "TAKEN" } }
				})
				.put("/nickname", async ({ env, keyId, body, set }) => {
					const { success } = await env.RATE_LIMITER.limit({
						key: `nickname_write:${keyId}`,
						maxRequests: config.auth.nickname.write.maxRequests,
						windowSeconds: config.auth.nickname.write.windowSeconds,
					})
					if (!success) {
						set.status = 429
						return { success: false, error: "RATE_LIMITED" }
					}

					const raw = (body as { nickname?: unknown }).nickname
					const nickname = typeof raw === "string" ? raw : ""
					if (!new RegExp(config.auth.nickname.pattern).test(nickname)) {
						set.status = 400
						return { success: false, error: "INVALID_FORMAT" }
					}

					const result = await setNickname(env, keyId, nickname)
					if (!result.ok) {
						set.status = 409
						return { success: false, error: "NICKNAME_TAKEN" }
					}

					return {
						success: true,
						data: { keyId, displayName: await resolveDisplayName(env, keyId) },
					}
				})
				.delete("/nickname", async ({ env, keyId }) => {
					await clearNickname(env, keyId)
					return {
						success: true,
						data: { keyId, displayName: await resolveDisplayName(env, keyId) },
					}
				})
				.post("/nickname/me", async ({ env, keyId }) => {
					return {
						success: true,
						data: { keyId, displayName: await resolveDisplayName(env, keyId) },
					}
				})
		)
		.use(
			new Elysia()
				.decorate("env", env)
				.use(signedRequest)
				.post("/session", async ({ env, keyId, signedPayload, headers, set }) => {
					const signedOrigin = signedPayload.origin
					const requestOrigin = headers.origin
					if (
						typeof signedOrigin !== "string" ||
						!requestOrigin ||
						requestOrigin !== signedOrigin
					) {
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
							displayName: await resolveDisplayName(env, keyId),
						},
					}
				})
		)
