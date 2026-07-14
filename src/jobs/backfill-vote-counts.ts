import { Logger } from "@/infra/logger"
import type { Env } from "@/types"

const log = new Logger("backfill")

// upvotes/downvotes were only ever maintained incrementally, while vote_count
// gets resynced from the votes table by recalculateScore. The two could drift,
// and a drifted row can be a cold challenger by vote_count while carrying a huge
// upvotes/downvotes. Recompute both from the authoritative votes rows.
// Idempotent: after the first run the WHERE guard matches nothing.
export async function backfillVoteCounts(env: Env): Promise<{ repaired: number }> {
	const drifted = await env.DB.prepare(
		`SELECT COUNT(*) AS n FROM lyrics
		 WHERE upvotes <> (SELECT COUNT(*) FROM votes v WHERE v.lyrics_id = lyrics.id AND v.vote = 1)
		    OR downvotes <> (SELECT COUNT(*) FROM votes v WHERE v.lyrics_id = lyrics.id AND v.vote = -1)`
	).first<{ n: number }>()

	const repaired = Number(drifted?.n ?? 0)
	if (repaired === 0) return { repaired: 0 }

	await env.DB.prepare(
		`UPDATE lyrics SET
			upvotes = (SELECT COUNT(*) FROM votes v WHERE v.lyrics_id = lyrics.id AND v.vote = 1),
			downvotes = (SELECT COUNT(*) FROM votes v WHERE v.lyrics_id = lyrics.id AND v.vote = -1),
			updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
		 WHERE upvotes <> (SELECT COUNT(*) FROM votes v WHERE v.lyrics_id = lyrics.id AND v.vote = 1)
		    OR downvotes <> (SELECT COUNT(*) FROM votes v WHERE v.lyrics_id = lyrics.id AND v.vote = -1)`
	).run()

	log.info("vote count repair complete", { repaired })
	return { repaired }
}
