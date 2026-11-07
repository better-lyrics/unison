import { COUNTED_VOTE_PREDICATE } from "@/db/predicates"
import { Logger } from "@/infra/logger"
import { recalculateScore } from "@/jobs/score-updater"
import type { Env } from "@/types"

const log = new Logger("backfill")

const counted = (vote: 1 | -1) =>
	`(SELECT COUNT(*) FROM votes v JOIN users u ON u.id = v.user_id
		WHERE v.lyrics_id = lyrics.id AND v.vote = ${vote} AND ${COUNTED_VOTE_PREDICATE})`

// upvotes/downvotes were only ever maintained incrementally, while vote_count
// gets resynced from the votes table by recalculateScore. The two could drift,
// and a drifted row can be a cold challenger by vote_count while carrying a huge
// upvotes/downvotes. recalculateScore rewrites them together with the score.
// Idempotent: after the first run the WHERE guard matches nothing.
export async function backfillVoteCounts(env: Env): Promise<{ repaired: number }> {
	const drifted = await env.DB.prepare(
		`SELECT id FROM lyrics
		 WHERE deleted_at IS NULL
		   AND (upvotes <> ${counted(1)} OR downvotes <> ${counted(-1)})
		 ORDER BY id`
	).all<{ id: number }>()

	let repaired = 0
	for (const { id } of drifted.results ?? []) {
		try {
			await recalculateScore(env, id)
			repaired++
		} catch (err) {
			log.error("vote count repair failed", { lyricsId: id, error: String(err) })
		}
	}

	if (repaired > 0) log.info("vote count repair complete", { repaired })
	return { repaired }
}
