import {
	awardConfidenceXp,
	awardFirstForSongXp,
	awardRequestFilledXp,
} from "@/db/contribution-events"
import { awardConsensusVotes } from "@/jobs/score-updater"
import type { Confidence, Env } from "@/types"

export async function backfillXp(
	env: Env
): Promise<{ lyrics: number; fulfillments: number; firsts: number }> {
	const lyricRows = await env.DB.prepare(
		"SELECT id, submitter_id, confidence FROM lyrics WHERE deleted_at IS NULL AND submitter_id IS NOT NULL"
	).all<{ id: number; submitter_id: number; confidence: Confidence }>()

	let lyrics = 0
	for (const row of lyricRows.results || []) {
		await awardConfidenceXp(env, row.submitter_id, row.id, row.confidence)
		lyrics++
	}

	await awardConsensusVotes(env)

	const fulfillmentRows = await env.DB.prepare(
		"SELECT id, submitter_id FROM request_fulfillments WHERE submitter_id IS NOT NULL"
	).all<{ id: string; submitter_id: number }>()

	let fulfillments = 0
	for (const row of fulfillmentRows.results || []) {
		await awardRequestFilledXp(env, row.submitter_id, Number(row.id))
		fulfillments++
	}

	const firstRows = await env.DB.prepare(
		"SELECT DISTINCT ON (video_id) id, submitter_id FROM lyrics WHERE deleted_at IS NULL ORDER BY video_id, id ASC"
	).all<{ id: number; submitter_id: number | null }>()

	let firsts = 0
	for (const row of firstRows.results || []) {
		if (row.submitter_id !== null) {
			await awardFirstForSongXp(env, row.submitter_id, row.id)
			firsts++
		}
	}

	return { lyrics, fulfillments, firsts }
}
