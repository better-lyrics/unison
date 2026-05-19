import { config } from "@/config"
import { AUTO_HIDE_PREDICATE } from "@/db/lyrics"
import type { Env } from "@/types"

export interface RequestDemand {
	demand: number
	requestCount: number
}

export type CreateRequestResult =
	| ({ status: "created" | "already_requested" } & RequestDemand)
	| { status: "already_available" }

export function windowCutoff(): number {
	return Math.floor(Date.now() / 1000) - config.requests.windowDays * 86400
}

async function hasServableSyncedVariant(env: Env, videoId: string): Promise<boolean> {
	const row = await env.DB.prepare(
		`SELECT 1 FROM lyrics
		 WHERE video_id = ?
		   AND sync_type IN ('linesync', 'richsync')
		   AND deleted_at IS NULL
		   AND NOT ${AUTO_HIDE_PREDICATE}
		 LIMIT 1`
	)
		.bind(videoId)
		.first()
	return row !== null
}

async function videoDemand(env: Env, videoId: string): Promise<RequestDemand> {
	const row = await env.DB.prepare(
		`SELECT COALESCE(SUM(weight), 0) AS demand, COUNT(*) AS request_count
		 FROM lyrics_requests
		 WHERE video_id = ? AND created_at > ?`
	)
		.bind(videoId, windowCutoff())
		.first<{ demand: number; request_count: number }>()
	return {
		demand: Number(row?.demand ?? 0),
		requestCount: Number(row?.request_count ?? 0),
	}
}

export async function createRequest(
	env: Env,
	params: {
		videoId: string
		song: string
		artist: string
		thumbnailUrl: string | null
		requesterId: string
		requesterType: "extension" | "discord"
		weight: number
	}
): Promise<CreateRequestResult> {
	if (await hasServableSyncedVariant(env, params.videoId)) {
		return { status: "already_available" }
	}

	const now = Math.floor(Date.now() / 1000)

	await env.DB.prepare(
		`INSERT INTO requested_songs
		   (video_id, song, artist, thumbnail_url, first_requested_at, last_requested_at)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT (video_id) DO UPDATE SET
		   song = EXCLUDED.song,
		   artist = EXCLUDED.artist,
		   thumbnail_url = EXCLUDED.thumbnail_url,
		   last_requested_at = EXCLUDED.last_requested_at`
	)
		.bind(params.videoId, params.song, params.artist, params.thumbnailUrl, now, now)
		.run()

	const inserted = await env.DB.prepare(
		`INSERT INTO lyrics_requests
		   (video_id, requester_id, requester_type, weight, created_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT (video_id, requester_id, requester_type) DO NOTHING
		 RETURNING id`
	)
		.bind(params.videoId, params.requesterId, params.requesterType, params.weight, now)
		.first<{ id: number }>()

	const demand = await videoDemand(env, params.videoId)
	return { status: inserted ? "created" : "already_requested", ...demand }
}
