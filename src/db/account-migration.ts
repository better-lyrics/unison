import type { Env } from "@/types"
import type { MigrationCounts } from "@/utils/migration-session"

export interface MigrationResolved {
	oldUserId: number
	newUserId: number | null
	counts: MigrationCounts
}

async function count(env: Env, sql: string, params: unknown[]): Promise<number> {
	const row = await env.DB.prepare(sql)
		.bind(...params)
		.first<{ n: number }>()
	return row?.n ?? 0
}

// Reads only: resolve the two identities and project what a commit would move.
export async function computeMigrationPlan(
	env: Env,
	oldKey: string,
	newKey: string
): Promise<MigrationResolved | { error: "OLD_KEY_NO_USER" }> {
	const oldUser = await env.DB.prepare("SELECT id FROM users WHERE key_id = ?")
		.bind(oldKey)
		.first<{ id: number }>()
	if (!oldUser) return { error: "OLD_KEY_NO_USER" }
	const oldUserId = oldUser.id

	const newUser = await env.DB.prepare("SELECT id FROM users WHERE key_id = ?")
		.bind(newKey)
		.first<{ id: number }>()
	const newUserId = newUser?.id ?? null

	let submissions = 0
	let votes = 0
	let reports = 0
	let fulfillments = 0
	let voteCollisions = 0
	let reportCollisions = 0

	if (newUserId !== null) {
		submissions = await count(env, "SELECT COUNT(*)::int AS n FROM lyrics WHERE submitter_id = ?", [
			newUserId,
		])
		votes = await count(env, "SELECT COUNT(*)::int AS n FROM votes WHERE user_id = ?", [newUserId])
		reports = await count(env, "SELECT COUNT(*)::int AS n FROM reports WHERE user_id = ?", [
			newUserId,
		])
		fulfillments = await count(
			env,
			"SELECT COUNT(*)::int AS n FROM request_fulfillments WHERE submitter_id = ?",
			[newUserId]
		)
		voteCollisions = await count(
			env,
			"SELECT COUNT(*)::int AS n FROM votes WHERE user_id = ? AND lyrics_id IN (SELECT lyrics_id FROM votes WHERE user_id = ?)",
			[newUserId, oldUserId]
		)
		reportCollisions = await count(
			env,
			"SELECT COUNT(*)::int AS n FROM reports WHERE user_id = ? AND lyrics_id IN (SELECT lyrics_id FROM reports WHERE user_id = ?)",
			[newUserId, oldUserId]
		)
	}

	const reqCollisions = await count(
		env,
		`SELECT COUNT(*)::int AS n FROM lyrics_requests
		 WHERE requester_id = ? AND requester_type = 'extension'
		   AND video_id IN (SELECT video_id FROM lyrics_requests WHERE requester_id = ? AND requester_type = 'extension')`,
		[newKey, oldKey]
	)

	return {
		oldUserId,
		newUserId,
		counts: {
			submissions,
			votes,
			reports,
			fulfillments,
			collisions: voteCollisions + reportCollisions + reqCollisions,
		},
	}
}
