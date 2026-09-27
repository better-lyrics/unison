import { advisoryXactLock } from "@/infra/database"
import type { Env } from "@/types"

const BACKFILLS = [
	`INSERT INTO council_events (actor_id, kind, source, lyrics_id, ref_id, created_at)
	 SELECT booster_id, 'seal', 'discord', lyrics_id, id, created_at FROM boosts
	 ON CONFLICT DO NOTHING RETURNING id`,
	`INSERT INTO council_events (actor_id, kind, source, lyrics_id, ref_id, created_at)
	 SELECT NULL, 'unseal', 'discord', lyrics_id, id, revoked_at FROM boosts WHERE revoked_at IS NOT NULL
	 ON CONFLICT DO NOTHING RETURNING id`,
	`INSERT INTO council_events (actor_id, kind, source, lyrics_id, ref_id, note, created_at)
	 SELECT rejected_by, 'reject', 'discord', lyrics_id, id, note, rejected_at FROM rejections
	 ON CONFLICT DO NOTHING RETURNING id`,
	`INSERT INTO council_events (actor_id, kind, source, lyrics_id, ref_id, created_at)
	 SELECT NULL, 'unreject', 'discord', lyrics_id, id, revoked_at FROM rejections WHERE revoked_at IS NOT NULL
	 ON CONFLICT DO NOTHING RETURNING id`,
	`INSERT INTO council_events (actor_id, kind, source, lyrics_id, ref_id, note, created_at)
	 SELECT reviewed_by,
		CASE WHEN status = 'rejected' THEN 'edit_reject' ELSE 'edit_approve' END,
		'discord', lyrics_id, id, review_note, reviewed_at
	 FROM lyric_revisions
	 WHERE reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND status IN ('live', 'past', 'rejected')
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
		AND NOT EXISTS (
			SELECT 1 FROM council_events e
			WHERE e.kind IN ('applicant_approve', 'applicant_reject') AND e.ref_id = s.id)
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
