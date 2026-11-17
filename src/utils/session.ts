import { config } from "@/config"
import type { Env } from "@/types"

interface SessionRecord {
	keyId: string
	issuedAt: number
	expiresAt: number
}

const SESSION_PREFIX = "session:"

export function generateSessionToken(): string {
	const bytes = new Uint8Array(32)
	crypto.getRandomValues(bytes)
	let bin = ""
	for (const b of bytes) bin += String.fromCharCode(b)
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export async function createSession(
	env: Env,
	keyId: string
): Promise<{ token: string; expiresAt: number }> {
	const token = generateSessionToken()
	const ttl = config.auth.session.ttlSeconds
	const issuedAt = Math.floor(Date.now() / 1000)
	const expiresAt = issuedAt + ttl
	const record: SessionRecord = { keyId, issuedAt, expiresAt }
	await env.CACHE.put(`${SESSION_PREFIX}${token}`, JSON.stringify(record), {
		expirationTtl: ttl,
	})
	return { token, expiresAt }
}

export async function getSession(env: Env, token: string): Promise<SessionRecord | null> {
	const raw = await env.CACHE.get(`${SESSION_PREFIX}${token}`)
	if (!raw) return null
	try {
		return JSON.parse(raw) as SessionRecord
	} catch {
		return null
	}
}

export function bearerToken(authorization: string | undefined): string | null {
	if (!authorization?.startsWith("Bearer ")) return null
	const token = authorization.slice(7).trim()
	return token.length > 0 ? token : null
}

export async function bearerKeyId(
	env: Env,
	authorization: string | undefined
): Promise<string | null> {
	const token = bearerToken(authorization)
	if (!token) return null
	return (await getSession(env, token))?.keyId ?? null
}

export async function deleteSession(env: Env, token: string): Promise<void> {
	await env.CACHE.delete(`${SESSION_PREFIX}${token}`)
}
