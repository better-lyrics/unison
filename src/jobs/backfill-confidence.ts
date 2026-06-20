import { config } from "@/config"
import { invalidateCache } from "@/db/lyrics"
import { Logger } from "@/infra/logger"
import type { Env } from "@/types"

const log = new Logger("backfill")

export async function backfillConfidence(env: Env): Promise<{ updated: number }> {
	const threshold = config.reputation.minVotesForConfidence
	const scoreFloor = config.reputation.minScoreForConfidence
	// Reproduces the confidence rule in calculateScore (score-updater.ts) in SQL.
	// If that rule changes, update this expression to match.
	const tierExpr = `CASE
			WHEN vote_count >= ${threshold} AND effective_score >= ${scoreFloor} AND diversity_bonus = 1 THEN 'high'
			WHEN vote_count >= ${threshold} AND effective_score >= ${scoreFloor} THEN 'medium'
			ELSE 'low'
		END`

	const changed = await env.DB.prepare(
		`SELECT id, video_id FROM lyrics WHERE deleted_at IS NULL AND confidence <> ${tierExpr}`
	).all<{ id: number; video_id: string }>()

	const rows = changed.results || []
	if (rows.length === 0) return { updated: 0 }

	await env.DB.prepare(
		`UPDATE lyrics SET confidence = ${tierExpr} WHERE deleted_at IS NULL AND confidence <> ${tierExpr}`
	).run()

	const videoIds = [...new Set(rows.map((r) => r.video_id))]
	for (const videoId of videoIds) {
		await invalidateCache(env, videoId)
	}

	log.info("confidence backfill complete", { updated: rows.length, videos: videoIds.length })
	return { updated: rows.length }
}
