import type { Env, User } from "@/types"

export async function getOrCreateUser(env: Env, deviceHash: string): Promise<User> {
	const existing = await env.DB.prepare("SELECT * FROM users WHERE device_hash = ?")
		.bind(deviceHash)
		.first<User>()

	if (existing) {
		return existing
	}

	const result = await env.DB.prepare(
		"INSERT INTO users (device_hash) VALUES (?) RETURNING *"
	)
		.bind(deviceHash)
		.first<User>()

	return result!
}

export async function getUserById(env: Env, userId: number): Promise<User | null> {
	return env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<User>()
}

export async function updateUserReputation(
	env: Env,
	userId: number,
	delta: number
): Promise<void> {
	await env.DB.prepare(
		"UPDATE users SET reputation = MAX(0.0, MIN(2.0, reputation + ?)) WHERE id = ?"
	)
		.bind(delta, userId)
		.run()
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
