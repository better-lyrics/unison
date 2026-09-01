import type { D1Compat } from "@/infra/database"
import type { Env } from "@/types"
import type { MigrationCounts } from "@/utils/migration-session"

const now = () => Math.floor(Date.now() / 1000)

export interface MigrationResolved {
	oldUserId: number
	newUserId: number | null
	oldNickname: string | null
	newNickname: string | null
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
	const oldUser = await env.DB.prepare("SELECT id, nickname FROM users WHERE key_id = ?")
		.bind(oldKey)
		.first<{ id: number; nickname: string | null }>()
	if (!oldUser) return { error: "OLD_KEY_NO_USER" }
	const oldUserId = oldUser.id

	const newUser = await env.DB.prepare("SELECT id, nickname FROM users WHERE key_id = ?")
		.bind(newKey)
		.first<{ id: number; nickname: string | null }>()
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
		oldNickname: oldUser.nickname ?? null,
		newNickname: newUser?.nickname ?? null,
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

export async function runMigration(
	env: Env,
	params: { oldKey: string; newKey: string; keepNickname?: "old" | "new"; migrationId: number }
): Promise<MigrationResult | MigrationRunError> {
	const { oldKey, newKey, keepNickname, migrationId } = params
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
			submissions: newId !== null ? lyricsRows.filter((r) => r.submitter_id === newId).length : 0,
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

		if (keepNickname === "new" && newId !== null) {
			const newSnapUser = (snapshot.users as { key_id: string; nickname: string | null }[]).find(
				(u) => u.key_id === newKey
			)
			if (newSnapUser?.nickname) {
				await tx
					.prepare("UPDATE users SET nickname = ?, nickname_updated_at = ? WHERE id = ?")
					.bind(newSnapUser.nickname, now(), oldId)
					.run()
			}
		}

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

		await tx
			.prepare(
				`UPDATE migration_requests SET
					status = 'committed',
					moved_submissions = ?, moved_votes = ?, moved_reports = ?, moved_fulfillments = ?,
					collisions_dropped = ?, snapshot = ?::jsonb, updated_at = ?
				 WHERE id = ?`
			)
			.bind(
				moved.submissions,
				moved.votes,
				moved.reports,
				moved.fulfillments,
				moved.collisionsDropped,
				JSON.stringify(snapshot),
				now(),
				migrationId
			)
			.run()

		return { moved, snapshot, affectedLyricsIds, affectedVideoIds }
	})
}

export interface MigrationAuditRow {
	id: number
	session_id: string | null
	discord_id: string
	old_key: string
	new_key: string
	status: "preview" | "committed" | "failed"
	moved_submissions: number
	moved_votes: number
	moved_reports: number
	moved_fulfillments: number
	collisions_dropped: number
	snapshot: MigrationSnapshot | null
	error: string | null
	created_at: number
	updated_at: number
}

export async function createPreviewAudit(
	env: Env,
	params: {
		sessionId: string
		discordId: string
		oldKey: string
		newKey: string
		counts: MigrationCounts
	}
): Promise<number> {
	const { sessionId, discordId, oldKey, newKey, counts } = params
	const row = await env.DB.prepare(
		`INSERT INTO migration_requests
			(session_id, discord_id, old_key, new_key, status,
			 moved_submissions, moved_votes, moved_reports, moved_fulfillments, collisions_dropped)
		 VALUES (?, ?, ?, ?, 'preview', ?, ?, ?, ?, ?)
		 RETURNING id`
	)
		.bind(
			sessionId,
			discordId,
			oldKey,
			newKey,
			counts.submissions,
			counts.votes,
			counts.reports,
			counts.fulfillments,
			counts.collisions
		)
		.first<{ id: number }>()
	return row!.id
}

export async function markAuditFailed(env: Env, id: number, error: string): Promise<void> {
	await env.DB.prepare(
		"UPDATE migration_requests SET status = 'failed', error = ?, updated_at = " +
			"EXTRACT(EPOCH FROM NOW())::INTEGER WHERE id = ? AND status <> 'committed'"
	)
		.bind(error, id)
		.run()
}

export async function getAudit(env: Env, id: number): Promise<MigrationAuditRow | null> {
	return env.DB.prepare("SELECT * FROM migration_requests WHERE id = ?")
		.bind(id)
		.first<MigrationAuditRow>()
}

interface SnapUser {
	id: number
	key_id: string
	reputation: number
	vote_count: number
	avg_vote: number
	created_at: number
	nickname: string | null
	nickname_updated_at: number | null
}
interface SnapDiscord {
	discord_id: string
	key_id: string
	discord_username: string | null
	linked_at: number
}
interface SnapVote {
	id: number
	lyrics_id: number
	user_id: number
	vote: number
	is_self_vote: number
	created_at: number
}
interface SnapReport {
	id: number
	lyrics_id: number
	user_id: number
	reason: string
	details: string | null
	created_at: number
}
interface SnapLyrics {
	id: number
	submitter_id: number | null
	deleted_by_user_id: number | null
}
interface SnapFulfillment {
	id: number
	submitter_id: number | null
}
interface SnapRequest {
	id: number
	video_id: string
	requester_id: string
	requester_type: string
	weight: number
	created_at: number
}

// Restores lyrics by UPDATE, never DELETE: deleting a lyric cascades to its votes/reports.
export async function restoreFromSnapshot(
	env: Env,
	migrationId: number
): Promise<{ restored: true } | { error: "NOT_FOUND" | "NOT_COMMITTED" | "HAS_INTERIM_ACTIVITY" }> {
	const audit = await getAudit(env, migrationId)
	if (!audit) return { error: "NOT_FOUND" }
	if (audit.status !== "committed" || !audit.snapshot) return { error: "NOT_COMMITTED" }

	const snap = audit.snapshot
	const oldKey = audit.old_key
	const newKey = audit.new_key
	const users = snap.users as SnapUser[]
	const oldSnap = users.find((u) => u.key_id === oldKey)
	const newSnap = users.find((u) => u.key_id === newKey)
	if (!oldSnap) return { error: "NOT_COMMITTED" }
	const ids = newSnap ? [oldSnap.id, newSnap.id] : [oldSnap.id]

	return env.DB.transaction(async (tx) => {
		const snapVoteIds = new Set((snap.votes as SnapVote[]).map((v) => v.id))
		const snapReportIds = new Set((snap.reports as SnapReport[]).map((r) => r.id))
		const currentVotes = await all<{ id: number }>(
			tx,
			"SELECT id FROM votes WHERE user_id = ANY(?)",
			[ids]
		)
		const currentReports = await all<{ id: number }>(
			tx,
			"SELECT id FROM reports WHERE user_id = ANY(?)",
			[ids]
		)
		if (
			currentVotes.some((v) => !snapVoteIds.has(v.id)) ||
			currentReports.some((r) => !snapReportIds.has(r.id))
		) {
			return { error: "HAS_INTERIM_ACTIVITY" } as const
		}

		await tx
			.prepare(
				"UPDATE users SET key_id = ?, reputation = ?, vote_count = ?, avg_vote = ?, nickname = ?, nickname_updated_at = ? WHERE id = ?"
			)
			.bind(
				oldSnap.key_id,
				oldSnap.reputation,
				oldSnap.vote_count,
				oldSnap.avg_vote,
				oldSnap.nickname,
				oldSnap.nickname_updated_at,
				oldSnap.id
			)
			.run()

		if (newSnap) {
			await tx
				.prepare(
					"INSERT INTO users (id, key_id, reputation, vote_count, avg_vote, created_at, nickname, nickname_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
				)
				.bind(
					newSnap.id,
					newSnap.key_id,
					newSnap.reputation,
					newSnap.vote_count,
					newSnap.avg_vote,
					newSnap.created_at,
					newSnap.nickname,
					newSnap.nickname_updated_at
				)
				.run()
		}

		await tx.prepare("DELETE FROM discord_links WHERE key_id = ANY(?)").bind([oldKey, newKey]).run()
		for (const d of snap.discord_links as SnapDiscord[]) {
			await tx
				.prepare(
					"INSERT INTO discord_links (discord_id, key_id, discord_username, linked_at) VALUES (?, ?, ?, ?)"
				)
				.bind(d.discord_id, d.key_id, d.discord_username, d.linked_at)
				.run()
		}

		await tx.prepare("DELETE FROM votes WHERE user_id = ANY(?)").bind(ids).run()
		for (const v of snap.votes as SnapVote[]) {
			await tx
				.prepare(
					"INSERT INTO votes (id, lyrics_id, user_id, vote, is_self_vote, created_at) VALUES (?, ?, ?, ?, ?, ?)"
				)
				.bind(v.id, v.lyrics_id, v.user_id, v.vote, v.is_self_vote, v.created_at)
				.run()
		}

		await tx.prepare("DELETE FROM reports WHERE user_id = ANY(?)").bind(ids).run()
		for (const r of snap.reports as SnapReport[]) {
			await tx
				.prepare(
					"INSERT INTO reports (id, lyrics_id, user_id, reason, details, created_at) VALUES (?, ?, ?, ?, ?, ?)"
				)
				.bind(r.id, r.lyrics_id, r.user_id, r.reason, r.details, r.created_at)
				.run()
		}

		for (const l of snap.lyrics as SnapLyrics[]) {
			await tx
				.prepare("UPDATE lyrics SET submitter_id = ?, deleted_by_user_id = ? WHERE id = ?")
				.bind(l.submitter_id, l.deleted_by_user_id, l.id)
				.run()
		}

		for (const f of snap.request_fulfillments as SnapFulfillment[]) {
			await tx
				.prepare("UPDATE request_fulfillments SET submitter_id = ? WHERE id = ?")
				.bind(f.submitter_id, f.id)
				.run()
		}

		await tx
			.prepare("DELETE FROM lyrics_requests WHERE requester_id = ANY(?)")
			.bind([oldKey, newKey])
			.run()
		for (const rq of snap.lyrics_requests as SnapRequest[]) {
			await tx
				.prepare(
					"INSERT INTO lyrics_requests (id, video_id, requester_id, requester_type, weight, created_at) VALUES (?, ?, ?, ?, ?, ?)"
				)
				.bind(rq.id, rq.video_id, rq.requester_id, rq.requester_type, rq.weight, rq.created_at)
				.run()
		}

		return { restored: true } as const
	})
}
