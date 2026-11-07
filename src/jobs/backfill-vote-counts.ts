import { COUNTED_VOTE_PREDICATE } from "@/db/predicates"
import { Logger } from "@/infra/logger"
import type { Env } from "@/types"

const log = new Logger("backfill")

const counted = (vote: 1 | -1) =>
	`(SELECT COUNT(*) FROM votes v JOIN users u ON u.id = v.user_id
		WHERE v.lyrics_id = lyrics.id AND v.vote = ${vote} AND ${COUNTED_VOTE_PREDICATE})`

// upvotes/downvotes were only ever maintained incrementally, while vote_count
// gets resynced from the votes table by recalculateScore. The two could drift,
// and a drifted row can be a cold challenger by vote_count while carrying a huge
// upvotes/downvotes. Recompute both from the authoritative votes rows.
// Idempotent: after the first run the WHERE guard matches nothing.
export async function backfillVoteCounts(env: Env): Promise<{ repaired: number }> {
	const drifted = await env.DB.prepare(
		`SELECT COUNT(*) AS n FROM lyrics
		 WHERE upvotes <> ${counted(1)}
		    OR downvotes <> ${counted(-1)}`
	).first<{ n: number }>()

	const repaired = Number(drifted?.n ?? 0)
	if (repaired === 0) return { repaired: 0 }

	await env.DB.prepare(
		`UPDATE lyrics SET
			upvotes = ${counted(1)},
			downvotes = ${counted(-1)},
			updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
		 WHERE upvotes <> ${counted(1)}
		    OR downvotes <> ${counted(-1)}`
	).run()

	log.info("vote count repair complete", { repaired })
	return { repaired }
}
