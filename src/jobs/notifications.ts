import { config } from "@/config"
import { notify } from "@/db/notifications"
import { WAITING_KINDS } from "@/notifications/kinds"
import type { Env, PendingReason } from "@/types"
import { ownerlessSql, patchSql, suggestionDecider } from "@/utils/lyric-patch"

interface ReminderRow {
	id: number
	lyrics_id: number
	rev_no: number
	author_id: number
	submitter_id: number
	created_at: number
	pending_reason: PendingReason | null
	sealed: boolean
	ownerless: boolean
}

export async function queueOwnerReminders(
	env: Env,
	now = Math.floor(Date.now() / 1000)
): Promise<number> {
	const { ownerDecisionSec } = config.revisions
	const { results } = await env.DB.prepare(
		`SELECT r.id, r.lyrics_id, r.rev_no, r.author_id, l.submitter_id, r.created_at, r.pending_reason,
			l.committee_approved_at IS NOT NULL AS sealed,
			${ownerlessSql("l")} AS ownerless
		 FROM lyric_revisions r
		 JOIN lyrics l ON l.id = r.lyrics_id
		 WHERE r.status = 'pending'
			AND ${patchSql("r", "l")}
			AND l.deleted_at IS NULL
			AND r.created_at + ? BETWEEN ? AND ?`
	)
		.bind(ownerDecisionSec, now, now + config.notifications.reminderLeadSec)
		.all<ReminderRow>()

	const due = results.filter(
		(r) => suggestionDecider(r.pending_reason, r.sealed, r.ownerless) === "owner"
	)
	for (const r of due) {
		await notify(env.DB, {
			userId: r.submitter_id,
			kind: "suggestion_deadline",
			refId: r.id,
			actorId: r.author_id,
			lyricsId: r.lyrics_id,
			data: { revNo: r.rev_no, decidesAt: r.created_at + ownerDecisionSec },
		})
	}
	return due.length
}

export async function pruneNotifications(
	env: Env,
	now = Math.floor(Date.now() / 1000)
): Promise<number> {
	const row = await env.DB.prepare(
		`WITH pruned AS (
			DELETE FROM notifications n
			WHERE n.created_at < ?
				AND NOT (
					n.kind = ANY(?)
					AND EXISTS (SELECT 1 FROM lyric_revisions r WHERE r.id = n.ref_id AND r.status = 'pending')
				)
			RETURNING 1
		)
		SELECT COUNT(*)::int AS n FROM pruned`
	)
		.bind(now - config.notifications.windowSec, WAITING_KINDS)
		.first<{ n: number }>()
	return row?.n ?? 0
}
