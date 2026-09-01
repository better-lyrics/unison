import { config } from "@/config"
import type { Env } from "@/types"
import { generateSessionToken } from "./session"

export type MigrationStatus = "awaiting_new_key" | "ready" | "committed" | "failed"

export interface MigrationCounts {
	submissions: number
	votes: number
	reports: number
	fulfillments: number
	collisions: number
}

export interface MigrationSession {
	sessionId: string
	discordId: string
	oldKey: string
	newKey: string | null
	status: MigrationStatus
	failureReason?: string
	oldNickname: string | null
	newNickname: string | null
	counts: MigrationCounts | null
	migrationId: number | null
	createdAt: number
}

const SESSION_PREFIX = "migration:"
const DISCORD_INDEX_PREFIX = "migration:by-discord:"

const COMMIT_LOCK_PREFIX = "migration:commit-lock:"

const sessionKey = (sessionId: string) => `${SESSION_PREFIX}${sessionId}`
const indexKey = (discordId: string) => `${DISCORD_INDEX_PREFIX}${discordId}`
export const commitLockKey = (sessionId: string) => `${COMMIT_LOCK_PREFIX}${sessionId}`

export async function createSession(
	env: Env,
	params: { discordId: string; oldKey: string }
): Promise<MigrationSession> {
	const session: MigrationSession = {
		sessionId: generateSessionToken(),
		discordId: params.discordId,
		oldKey: params.oldKey,
		newKey: null,
		status: "awaiting_new_key",
		oldNickname: null,
		newNickname: null,
		counts: null,
		migrationId: null,
		createdAt: Math.floor(Date.now() / 1000),
	}
	await saveSession(env, session)
	return session
}

export async function saveSession(env: Env, session: MigrationSession): Promise<void> {
	await env.CACHE.put(sessionKey(session.sessionId), JSON.stringify(session), {
		expirationTtl: config.migration.sessionTtlSeconds,
	})
	await env.CACHE.put(indexKey(session.discordId), session.sessionId, {
		expirationTtl: config.migration.sessionTtlSeconds,
	})
}

export async function getSession(env: Env, sessionId: string): Promise<MigrationSession | null> {
	const raw = await env.CACHE.get(sessionKey(sessionId))
	if (!raw) return null
	try {
		return JSON.parse(raw) as MigrationSession
	} catch {
		return null
	}
}

export async function getActiveSessionForDiscord(
	env: Env,
	discordId: string
): Promise<MigrationSession | null> {
	const sessionId = await env.CACHE.get(indexKey(discordId))
	if (!sessionId) return null
	const session = await getSession(env, sessionId)
	if (!session) return null
	if (session.status === "committed" || session.status === "failed") return null
	return session
}

export async function clearDiscordIndex(env: Env, discordId: string): Promise<void> {
	await env.CACHE.delete(indexKey(discordId))
}
