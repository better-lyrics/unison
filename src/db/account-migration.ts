import type { D1Compat } from "@/infra/database"
import type { Env } from "@/types"
import type { MigrationCounts } from "@/utils/migration-session"

export interface MigrationResolved {
	oldUserId: number
	newUserId: number | null
	counts: MigrationCounts
}

export interface MigrationSnapshot {
	users: unknown[]
	votes: unknown[]
	reports: unknown[]
	lyrics: unknown[]
	request_fulfillments: unknown[]
	discord_links: unknown[]
	lyrics_requests: unknown[]
}

export interface MigrationResult {
	moved: {
		submissions: number
		votes: number
		reports: number
		fulfillments: number
		collisionsDropped: number
	}
	snapshot: MigrationSnapshot
	affectedLyricsIds: number[]
	affectedVideoIds: string[]
}

export type MigrationRunError =
	| { error: "OLD_KEY_NO_USER" }
	| { error: "SAME_KEY" }
	| { error: "BOTH_KEYS_LINKED" }

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

async function all<T>(tx: D1Compat, sql: string, params: unknown[]): Promise<T[]> {
	const { results } = await tx
		.prepare(sql)
		.bind(...params)
		.all<T>()
	return results
}

async function countTx(tx: D1Compat, sql: string, params: unknown[]): Promise<number> {
	const row = await tx
		.prepare(sql)
		.bind(...params)
		.first<{ n: number }>()
	return row?.n ?? 0
}

// Move the OLD identity's whole history onto NEW key in one transaction.
// The OLD users row survives (it owns the history) and is relabelled to NEW key;
// if NEW already had its own users row, its activity is folded in first, dropping
// duplicate votes/reports on the UNIQUE(lyrics_id, user_id) constraint.
export async function runMigration(
	env: Env,
	params: { oldKey: string; newKey: string }
): Promise<MigrationResult | MigrationRunError> {
	const { oldKey, newKey } = params
	if (oldKey === newKey) return { error: "SAME_KEY" }

	return env.DB.transaction(async (tx) => {
		const oldUser = await tx
			.prepare("SELECT id FROM users WHERE key_id = ?")
			.bind(oldKey)
			.first<{ id: number }>()
		if (!oldUser) return { error: "OLD_KEY_NO_USER" } as const
		const oldId = oldUser.id

		const newUser = await tx
			.prepare("SELECT id FROM users WHERE key_id = ?")
			.bind(newKey)
			.first<{ id: number }>()
		const newId = newUser?.id ?? null

		const oldLink = await tx
			.prepare("SELECT discord_id FROM discord_links WHERE key_id = ?")
			.bind(oldKey)
			.first<{ discord_id: string }>()
		const newLink = await tx
			.prepare("SELECT discord_id FROM discord_links WHERE key_id = ?")
			.bind(newKey)
			.first<{ discord_id: string }>()
		if (oldLink && newLink) return { error: "BOTH_KEYS_LINKED" } as const

		const ids = newId !== null ? [oldId, newId] : [oldId]
		const keys = [oldKey, newKey]

		const snapshot: MigrationSnapshot = {
			users: await all(tx, "SELECT * FROM users WHERE key_id = ANY(?)", [keys]),
			votes: await all(tx, "SELECT * FROM votes WHERE user_id = ANY(?)", [ids]),
			reports: await all(tx, "SELECT * FROM reports WHERE user_id = ANY(?)", [ids]),
			lyrics: await all(
				tx,
				"SELECT * FROM lyrics WHERE submitter_id = ANY(?) OR deleted_by_user_id = ANY(?)",
				[ids, ids]
			),
			request_fulfillments: await all(
				tx,
				"SELECT * FROM request_fulfillments WHERE submitter_id = ANY(?)",
				[ids]
			),
			discord_links: await all(tx, "SELECT * FROM discord_links WHERE key_id = ANY(?)", [keys]),
			lyrics_requests: await all(tx, "SELECT * FROM lyrics_requests WHERE requester_id = ANY(?)", [
				keys,
			]),
		}

		const votesRows = snapshot.votes as { user_id: number; lyrics_id: number }[]
		const lyricsRows = snapshot.lyrics as { id: number; submitter_id: number | null; video_id: string }[]
		const reportsRows = snapshot.reports as { user_id: number }[]
		const fulfillmentRows = snapshot.request_fulfillments as { submitter_id: number | null }[]

		const moved = {
			submissions: lyricsRows.filter((r) => r.submitter_id === newId).length,
			votes: votesRows.filter((r) => r.user_id === newId).length,
			reports: reportsRows.filter((r) => r.user_id === newId).length,
			fulfillments: fulfillmentRows.filter((r) => r.submitter_id === newId).length,
			collisionsDropped: 0,
		}

		const affectedLyricsIds = [
			...new Set<number>([...votesRows.map((r) => r.lyrics_id), ...lyricsRows.map((r) => r.id)]),
		]
		const affectedVideoIds = [...new Set<string>(lyricsRows.map((r) => r.video_id))]

		let voteCollisions = 0
		let reportCollisions = 0
		if (newId !== null) {
			voteCollisions = await countTx(
				tx,
				"SELECT COUNT(*)::int AS n FROM votes WHERE user_id = ? AND lyrics_id IN (SELECT lyrics_id FROM votes WHERE user_id = ?)",
				[newId, oldId]
			)
			await tx
				.prepare(
					"DELETE FROM votes WHERE user_id = ? AND lyrics_id IN (SELECT lyrics_id FROM votes WHERE user_id = ?)"
				)
				.bind(newId, oldId)
				.run()
			await tx.prepare("UPDATE votes SET user_id = ? WHERE user_id = ?").bind(oldId, newId).run()

			reportCollisions = await countTx(
				tx,
				"SELECT COUNT(*)::int AS n FROM reports WHERE user_id = ? AND lyrics_id IN (SELECT lyrics_id FROM reports WHERE user_id = ?)",
				[newId, oldId]
			)
			await tx
				.prepare(
					"DELETE FROM reports WHERE user_id = ? AND lyrics_id IN (SELECT lyrics_id FROM reports WHERE user_id = ?)"
				)
				.bind(newId, oldId)
				.run()
			await tx.prepare("UPDATE reports SET user_id = ? WHERE user_id = ?").bind(oldId, newId).run()

			await tx
				.prepare("UPDATE lyrics SET submitter_id = ? WHERE submitter_id = ?")
				.bind(oldId, newId)
				.run()
			await tx
				.prepare("UPDATE lyrics SET deleted_by_user_id = ? WHERE deleted_by_user_id = ?")
				.bind(oldId, newId)
				.run()
			await tx
				.prepare("UPDATE request_fulfillments SET submitter_id = ? WHERE submitter_id = ?")
				.bind(oldId, newId)
				.run()
		}

		const reqCollisions = await countTx(
			tx,
			`SELECT COUNT(*)::int AS n FROM lyrics_requests
			 WHERE requester_id = ? AND requester_type = 'extension'
			   AND video_id IN (SELECT video_id FROM lyrics_requests WHERE requester_id = ? AND requester_type = 'extension')`,
			[newKey, oldKey]
		)
		await tx
			.prepare(
				`DELETE FROM lyrics_requests
				 WHERE requester_id = ? AND requester_type = 'extension'
				   AND video_id IN (SELECT video_id FROM lyrics_requests WHERE requester_id = ? AND requester_type = 'extension')`
			)
			.bind(newKey, oldKey)
			.run()
		await tx
			.prepare(
				"UPDATE lyrics_requests SET requester_id = ? WHERE requester_id = ? AND requester_type = 'extension'"
			)
			.bind(newKey, oldKey)
			.run()

		if (newId !== null) {
			await tx.prepare("DELETE FROM users WHERE id = ?").bind(newId).run()
		}
		await tx.prepare("UPDATE users SET key_id = ? WHERE id = ?").bind(newKey, oldId).run()

		if (oldLink) {
			await tx
				.prepare("UPDATE discord_links SET key_id = ? WHERE key_id = ?")
				.bind(newKey, oldKey)
				.run()
		}

		await tx
			.prepare(
				`UPDATE votes v SET is_self_vote = CASE WHEN l.submitter_id = v.user_id THEN 1 ELSE 0 END
				 FROM lyrics l WHERE l.id = v.lyrics_id AND (v.user_id = ? OR l.submitter_id = ?)`
			)
			.bind(oldId, oldId)
			.run()

		await tx
			.prepare(
				`UPDATE users SET
					avg_vote = COALESCE((SELECT AVG(vote)::float8 FROM votes WHERE user_id = ?), 0),
					vote_count = (SELECT COUNT(*)::int FROM votes WHERE user_id = ?)
				 WHERE id = ?`
			)
			.bind(oldId, oldId, oldId)
			.run()

		moved.collisionsDropped = voteCollisions + reportCollisions + reqCollisions

		return { moved, snapshot, affectedLyricsIds, affectedVideoIds }
	})
}
