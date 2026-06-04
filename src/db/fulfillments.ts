import { AUTO_HIDE_PREDICATE, AUTO_HIDE_PREDICATE_JOINED } from "@/db/predicates"
import { windowCutoff } from "@/db/requests"
import { Logger } from "@/infra/logger"
import type { Env } from "@/types"

const log = new Logger("db")

export type RecordFulfillmentResult =
	| { recorded: true; id: number; demand: number; requestCount: number }
	| { recorded: false; reason: "already_fulfilled" | "no_live_demand" }

interface RecordFulfillmentParams {
	videoId: string
	lyricsId: number
	submitterId: number
	submitterKeyId: string
}

export async function recordFulfillment(
	env: Env,
	params: RecordFulfillmentParams,
): Promise<RecordFulfillmentResult> {
	const priorServable = await env.DB.prepare(
		`SELECT 1 FROM lyrics
		 WHERE video_id = ?
		   AND id != ?
		   AND sync_type IN ('linesync', 'richsync')
		   AND deleted_at IS NULL
		   AND NOT ${AUTO_HIDE_PREDICATE}
		 LIMIT 1`,
	)
		.bind(params.videoId, params.lyricsId)
		.first()

	if (priorServable !== null) {
		return { recorded: false, reason: "already_fulfilled" }
	}

	const snapshot = await env.DB.prepare(
		`SELECT COALESCE(SUM(weight), 0) AS demand, COUNT(*) AS request_count
		 FROM lyrics_requests
		 WHERE video_id = ?
		   AND created_at > ?
		   AND requester_id != ?`,
	)
		.bind(params.videoId, windowCutoff(), params.submitterKeyId)
		.first<{ demand: number; request_count: number }>()

	const demand = Number(snapshot?.demand ?? 0)
	const requestCount = Number(snapshot?.request_count ?? 0)

	if (requestCount === 0) {
		return { recorded: false, reason: "no_live_demand" }
	}

	const inserted = await env.DB.prepare(
		`INSERT INTO request_fulfillments
		   (video_id, lyrics_id, submitter_id, demand_snapshot, request_count_snapshot)
		 VALUES (?, ?, ?, ?, ?)
		 RETURNING id`,
	)
		.bind(params.videoId, params.lyricsId, params.submitterId, demand, requestCount)
		.first<{ id: number }>()

	await env.DB.prepare("DELETE FROM lyrics_requests WHERE video_id = ?")
		.bind(params.videoId)
		.run()

	log.info("fulfillment recorded", {
		videoId: params.videoId,
		lyricsId: params.lyricsId,
		submitterId: params.submitterId,
		demand,
		requestCount,
	})

	return { recorded: true, id: inserted!.id, demand, requestCount }
}

export const LIVE_FULFILLMENTS_CTE = `
	SELECT f.*,
	       ROW_NUMBER() OVER (PARTITION BY f.video_id ORDER BY f.fulfilled_at DESC) AS rn
	FROM request_fulfillments f
	JOIN lyrics l ON l.id = f.lyrics_id
	WHERE l.deleted_at IS NULL AND NOT ${AUTO_HIDE_PREDICATE_JOINED}
`

export async function getFulfillmentByLyricsId(
	env: Env,
	lyricsId: number,
): Promise<{ demand: number; requestCount: number; fulfilledAt: number } | null> {
	const row = await env.DB.prepare(
		`SELECT f.demand_snapshot, f.request_count_snapshot, f.fulfilled_at
		 FROM request_fulfillments f
		 JOIN lyrics l ON l.id = f.lyrics_id
		 WHERE f.lyrics_id = ?
		   AND l.deleted_at IS NULL
		   AND NOT ${AUTO_HIDE_PREDICATE_JOINED}
		 LIMIT 1`,
	)
		.bind(lyricsId)
		.first<{ demand_snapshot: number; request_count_snapshot: number; fulfilled_at: number }>()

	if (!row) return null
	return {
		demand: Number(row.demand_snapshot),
		requestCount: Number(row.request_count_snapshot),
		fulfilledAt: Number(row.fulfilled_at),
	}
}

export async function getFulfillmentStatsBySubmitter(
	env: Env,
	submitterId: number,
): Promise<{ fulfilledCount: number; fulfilledDemand: number }> {
	const row = await env.DB.prepare(
		`SELECT COUNT(*) AS count, COALESCE(SUM(f.demand_snapshot), 0) AS demand
		 FROM request_fulfillments f
		 JOIN lyrics l ON l.id = f.lyrics_id
		 WHERE f.submitter_id = ?
		   AND l.deleted_at IS NULL
		   AND NOT ${AUTO_HIDE_PREDICATE_JOINED}`,
	)
		.bind(submitterId)
		.first<{ count: number; demand: number }>()

	return {
		fulfilledCount: Number(row?.count ?? 0),
		fulfilledDemand: Number(row?.demand ?? 0),
	}
}
