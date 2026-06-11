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

export async function updateUserReputation(env: Env, userId: number, delta: number): Promise<void> {
	await env.DB.prepare(
		"UPDATE users SET reputation = MAX(0.0, MIN(2.0, reputation + ?)) WHERE id = ?"
	)
		.bind(delta, userId)
		.run()
}

export async function resolveDisplayName(env: Env, keyId: string): Promise<string> {
	const row = await env.DB.prepare("SELECT nickname FROM users WHERE key_id = ?")
		.bind(keyId)
		.first<{ nickname: string | null }>()
	return row?.nickname ?? generatePetName(keyId)
}

export type SetNicknameResult = { ok: true } | { ok: false; reason: "TAKEN" }

export async function setNickname(
	env: Env,
	keyId: string,
	nickname: string
): Promise<SetNicknameResult> {
	const now = Math.floor(Date.now() / 1000)
	try {
		await env.DB.prepare(
			"UPDATE users SET nickname = ?, nickname_updated_at = ? WHERE key_id = ?"
		)
			.bind(nickname, now, keyId)
			.run()
	} catch (err) {
		if ((err as { code?: string }).code === "23505") {
			return { ok: false, reason: "TAKEN" }
		}
		throw err
	}
	await invalidateCacheForSubmitter(env, keyId)
	return { ok: true }
}

export async function clearNickname(env: Env, keyId: string): Promise<void> {
	const now = Math.floor(Date.now() / 1000)
	await env.DB.prepare(
		"UPDATE users SET nickname = NULL, nickname_updated_at = ? WHERE key_id = ?"
	)
		.bind(now, keyId)
		.run()
	await invalidateCacheForSubmitter(env, keyId)
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
