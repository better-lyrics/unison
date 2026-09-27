import { advisoryXactLock } from "@/infra/database"
import type { Env } from "@/types"

const unrecorded = (kinds: string, ref: string) =>
	`NOT EXISTS (SELECT 1 FROM council_events e WHERE e.kind IN (${kinds}) AND e.ref_id = ${ref})`

const BACKFILLS = [
	`INSERT INTO council_events (actor_id, kind, source, lyrics_id, ref_id, created_at)
	 SELECT b.booster_id, 'seal', 'discord', b.lyrics_id, b.id, b.created_at FROM boosts b
	 WHERE ${unrecorded("'seal'", "b.id")}
	 ON CONFLICT DO NOTHING RETURNING id`,
	`INSERT INTO council_events (actor_id, kind, source, lyrics_id, ref_id, created_at)
	 SELECT NULL, 'unseal', 'discord', b.lyrics_id, b.id, b.revoked_at FROM boosts b
	 WHERE b.revoked_at IS NOT NULL AND ${unrecorded("'unseal'", "b.id")}
	 ON CONFLICT DO NOTHING RETURNING id`,
	`INSERT INTO council_events (actor_id, kind, source, lyrics_id, ref_id, note, created_at)
	 SELECT r.rejected_by, 'reject', 'discord', r.lyrics_id, r.id, r.note, r.rejected_at FROM rejections r
	 WHERE ${unrecorded("'reject'", "r.id")}
	 ON CONFLICT DO NOTHING RETURNING id`,
	`INSERT INTO council_events (actor_id, kind, source, lyrics_id, ref_id, created_at)
	 SELECT NULL, 'unreject', 'discord', r.lyrics_id, r.id, r.revoked_at FROM rejections r
	 WHERE r.revoked_at IS NOT NULL AND ${unrecorded("'unreject'", "r.id")}
	 ON CONFLICT DO NOTHING RETURNING id`,
	`INSERT INTO council_events (actor_id, kind, source, lyrics_id, ref_id, note, created_at)
	 SELECT lr.reviewed_by,
		CASE WHEN lr.status = 'rejected' THEN 'edit_reject' ELSE 'edit_approve' END,
		'discord', lr.lyrics_id, lr.id, lr.review_note, lr.reviewed_at
	 FROM lyric_revisions lr
	 WHERE lr.reviewed_by IS NOT NULL AND lr.reviewed_at IS NOT NULL
		AND lr.status IN ('live', 'past', 'rejected')
		AND ${unrecorded("'edit_approve', 'edit_reject'", "lr.id")}
	 ON CONFLICT DO NOTHING RETURNING id`,
	`INSERT INTO council_events (actor_id, kind, source, subject_user_id, ref_id, created_at)
	 SELECT NULL, 'member_add', CASE WHEN c.added_by = 'bot' THEN 'discord' ELSE 'admin' END,
		c.user_id, c.user_id, c.added_at
	 FROM committee_members c
	 WHERE NOT EXISTS (
		SELECT 1 FROM council_events e WHERE e.kind = 'member_add' AND e.subject_user_id = c.user_id)
	 RETURNING id`,
	`INSERT INTO council_events (actor_id, kind, source, subject_user_id, ref_id, created_at)
	 SELECT decider.id,
		CASE WHEN s.state = 'approved' THEN 'applicant_approve' ELSE 'applicant_reject' END,
		'discord', applicant.id, s.id, s.decided_at
	 FROM exam_session s
	 LEFT JOIN users applicant ON applicant.key_id = s.key_id
	 LEFT JOIN discord_links dl ON dl.discord_id = s.decided_by_discord_id
	 LEFT JOIN users decider ON decider.key_id = dl.key_id
	 WHERE s.state IN ('approved', 'rejected') AND s.decided_at IS NOT NULL AND s.is_dev = FALSE
		AND ${unrecorded("'applicant_approve', 'applicant_reject'", "s.id")}
	 RETURNING id`,
]

export async function backfillCouncilEvents(env: Env): Promise<number> {
	return env.DB.transaction(async (tx) => {
		await advisoryXactLock(tx, "backfill-council-events")
		let inserted = 0
		for (const sql of BACKFILLS) {
			const rows = await tx.prepare(sql).bind().all<{ id: number }>()
			inserted += rows.results.length
		}
		return inserted
	})
}
