import { invalidateCuratorLeaderboardCache } from "@/db/leaderboard"
import { invalidateCacheForSubmitter } from "@/db/lyrics"
import type { Env, User } from "@/types"
import { generatePetName } from "@/utils/petname"

export async function getOrCreateUser(env: Env, keyId: string): Promise<User> {
	const existing = await env.DB.prepare("SELECT * FROM users WHERE key_id = ?")
		.bind(keyId)
		.first<User>()

	if (existing) {
		return existing
	}

	const result = await env.DB.prepare("INSERT INTO users (key_id) VALUES (?) RETURNING *")
		.bind(keyId)
		.first<User>()

	return result!
}

export async function getUserById(env: Env, userId: number): Promise<User | null> {
	return env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<User>()
}

export async function getUserByKeyId(env: Env, keyId: string): Promise<User | null> {
	return env.DB.prepare("SELECT * FROM users WHERE key_id = ?").bind(keyId).first<User>()
}

export async function updateUserReputation(env: Env, userId: number, delta: number): Promise<void> {
	await env.DB.prepare(
		"UPDATE users SET reputation = MAX(0.0, MIN(2.0, reputation + ?)) WHERE id = ?"
	)
		.bind(delta, userId)
		.run()
}

export interface UserIdentity {
	displayName: string
	handle: string | null
}

// The handle is the lowercased nickname (a unique, indexed generated column). Users
// without a nickname have no reversible handle, so it is null and they keep /curator/:keyId.
export async function resolveIdentity(env: Env, keyId: string): Promise<UserIdentity> {
	const row = await env.DB.prepare("SELECT nickname, nickname_lower FROM users WHERE key_id = ?")
		.bind(keyId)
		.first<{ nickname: string | null; nickname_lower: string | null }>()
	return {
		displayName: row?.nickname ?? generatePetName(keyId),
		handle: row?.nickname_lower ?? null,
	}
}

export async function resolveDisplayName(env: Env, keyId: string): Promise<string> {
	return (await resolveIdentity(env, keyId)).displayName
}

export async function resolveKeyIdByHandle(env: Env, handle: string): Promise<string | null> {
	const row = await env.DB.prepare("SELECT key_id FROM users WHERE nickname_lower = ?")
		.bind(handle.toLowerCase())
		.first<{ key_id: string }>()
	return row?.key_id ?? null
}

export type SetNicknameResult = { ok: true } | { ok: false; reason: "TAKEN" }

export async function setNickname(
	env: Env,
	keyId: string,
	nickname: string
): Promise<SetNicknameResult> {
	const now = Math.floor(Date.now() / 1000)
	try {
		await env.DB.prepare("UPDATE users SET nickname = ?, nickname_updated_at = ? WHERE key_id = ?")
			.bind(nickname, now, keyId)
			.run()
	} catch (err) {
		if ((err as { code?: string }).code === "23505") {
			return { ok: false, reason: "TAKEN" }
		}
		throw err
	}
	await invalidateCacheForSubmitter(env, keyId)
	await invalidateCuratorLeaderboardCache(env)
	return { ok: true }
}

export async function clearNickname(env: Env, keyId: string): Promise<void> {
	const now = Math.floor(Date.now() / 1000)
	await env.DB.prepare("UPDATE users SET nickname = NULL, nickname_updated_at = ? WHERE key_id = ?")
		.bind(now, keyId)
		.run()
	await invalidateCacheForSubmitter(env, keyId)
	await invalidateCuratorLeaderboardCache(env)
}

export interface AccountSearchRow {
	id: number
	key_id: string
	nickname: string | null
	reputation: number
	discord_id: string | null
	discord_username: string | null
	submissions: number
	votes: number
	reports: number
	requests: number
}

const ACCOUNT_SEARCH_SQL = `
	SELECT
		u.id, u.key_id, u.nickname, u.reputation,
		dl.discord_id, dl.discord_username,
		(SELECT COUNT(*)::int FROM lyrics l WHERE l.submitter_id = u.id AND l.deleted_at IS NULL) AS submissions,
		(SELECT COUNT(*)::int FROM votes v WHERE v.user_id = u.id) AS votes,
		(SELECT COUNT(*)::int FROM reports r WHERE r.user_id = u.id) AS reports,
		(SELECT COUNT(*)::int FROM lyrics_requests lr
			WHERE lr.requester_id = u.key_id AND lr.requester_type = 'extension') AS requests
	FROM users u
	LEFT JOIN discord_links dl ON dl.key_id = u.key_id
	WHERE u.key_id = ?
		OR u.key_id ILIKE ? || '%'
		OR u.id = ?
		OR u.nickname_lower LIKE '%' || LOWER(?) || '%'
		OR dl.discord_id = ?
		OR dl.discord_username ILIKE '%' || ? || '%'
	ORDER BY (u.key_id = ?) DESC, (u.key_id ILIKE ? || '%') DESC, u.reputation DESC NULLS LAST
	LIMIT ?
`

export async function searchAccounts(
	env: Env,
	query: string,
	limit: number
): Promise<AccountSearchRow[]> {
	const q = query.trim()
	const idMatch = /^\d{1,9}$/.test(q) ? Number.parseInt(q, 10) : null
	const { results } = await env.DB.prepare(ACCOUNT_SEARCH_SQL)
		.bind(q, q, idMatch, q, q, q, q, q, limit)
		.all<AccountSearchRow>()
	return results
}

export async function updateUserAvgVote(env: Env, userId: number): Promise<void> {
	await env.DB.prepare(
		`
		UPDATE users SET
			avg_vote = COALESCE((SELECT AVG(vote) FROM votes WHERE user_id = ?), 0),
			vote_count = (SELECT COUNT(*) FROM votes WHERE user_id = ?)
		WHERE id = ?
		`
	)
		.bind(userId, userId, userId)
		.run()
}
