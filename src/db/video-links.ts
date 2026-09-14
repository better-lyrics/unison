import { config } from "@/config"
import { invalidateCache, invalidateCacheForLyric } from "@/db/lyrics"
import type { Env } from "@/types"
import { getVideoDurationSeconds } from "@/utils/innertube"

export type VideoLink = { videoId: string; isPrimary: boolean }

type LinkTarget = {
	id: number
	submitter_id: number | null
	video_id: string
	duration: number
	deleted_at: number | null
}

export type LinkFailure =
	| "invalid_id"
	| "not_found"
	| "not_owner"
	| "unverifiable"
	| "duration_mismatch"
	| "cap_reached"

export type UnlinkFailure = "not_found" | "not_owner" | "cannot_unlink_primary"

export type LinkResult = { ok: true; videos: VideoLink[] } | { ok: false; reason: LinkFailure }
export type UnlinkResult = { ok: true; videos: VideoLink[] } | { ok: false; reason: UnlinkFailure }

const VIDEO_ID_LENGTH = 11

async function getLinkTarget(env: Env, lyricsId: number): Promise<LinkTarget | null> {
	return env.DB.prepare(
		"SELECT id, submitter_id, video_id, duration, deleted_at FROM lyrics WHERE id = ?"
	)
		.bind(lyricsId)
		.first<LinkTarget>()
}

export async function listVideoLinks(env: Env, lyricsId: number): Promise<VideoLink[]> {
	const rows = await env.DB.prepare(
		`SELECT lvi.video_id, (lvi.video_id = l.video_id) AS is_primary
		 FROM lyrics_video_ids lvi
		 JOIN lyrics l ON l.id = lvi.lyrics_id
		 WHERE lvi.lyrics_id = ?
		 ORDER BY is_primary DESC, lvi.created_at ASC`
	)
		.bind(lyricsId)
		.all<{ video_id: string; is_primary: boolean }>()
	return rows.results.map((r) => ({ videoId: r.video_id, isPrimary: r.is_primary }))
}

export async function countVideoLinks(env: Env, lyricsId: number): Promise<number> {
	const row = await env.DB.prepare(
		"SELECT COUNT(*)::INTEGER AS count FROM lyrics_video_ids WHERE lyrics_id = ?"
	)
		.bind(lyricsId)
		.first<{ count: number }>()
	return row?.count ?? 0
}

async function isLinked(env: Env, lyricsId: number, videoId: string): Promise<boolean> {
	const row = await env.DB.prepare(
		"SELECT 1 AS one FROM lyrics_video_ids WHERE lyrics_id = ? AND video_id = ?"
	)
		.bind(lyricsId, videoId)
		.first<{ one: number }>()
	return row !== null
}

type LinkDeps = { getDuration?: (videoId: string) => Promise<number | null> }

export async function linkVideoForOwner(
	env: Env,
	lyricsId: number,
	userId: number,
	videoId: string,
	deps: LinkDeps = {}
): Promise<LinkResult> {
	if (videoId.length !== VIDEO_ID_LENGTH) return { ok: false, reason: "invalid_id" }

	const row = await getLinkTarget(env, lyricsId)
	if (!row || row.deleted_at !== null) return { ok: false, reason: "not_found" }
	if (row.submitter_id !== userId) return { ok: false, reason: "not_owner" }

	if (videoId === row.video_id || (await isLinked(env, lyricsId, videoId))) {
		return { ok: true, videos: await listVideoLinks(env, lyricsId) }
	}

	const getDuration = deps.getDuration ?? getVideoDurationSeconds
	const candidateDuration = await getDuration(videoId)
	if (candidateDuration === null) return { ok: false, reason: "unverifiable" }
	if (Math.abs(candidateDuration - row.duration) > config.videoLinking.durationDeltaSeconds) {
		return { ok: false, reason: "duration_mismatch" }
	}

	const linked = await env.DB.transaction(async (tx) => {
		await tx.prepare("SELECT id FROM lyrics WHERE id = ? FOR UPDATE").bind(lyricsId).first()
		if (
			(await countVideoLinks({ ...env, DB: tx }, lyricsId)) >=
			config.videoLinking.maxVideosPerVariant
		) {
			return false
		}
		await tx
			.prepare(
				"INSERT INTO lyrics_video_ids (lyrics_id, video_id) VALUES (?, ?) ON CONFLICT DO NOTHING"
			)
			.bind(lyricsId, videoId)
			.run()
		return true
	})
	if (!linked) return { ok: false, reason: "cap_reached" }

	await invalidateCacheForLyric(env, lyricsId)

	return { ok: true, videos: await listVideoLinks(env, lyricsId) }
}

export async function unlinkVideoForOwner(
	env: Env,
	lyricsId: number,
	userId: number,
	videoId: string
): Promise<UnlinkResult> {
	const row = await getLinkTarget(env, lyricsId)
	if (!row || row.deleted_at !== null) return { ok: false, reason: "not_found" }
	if (row.submitter_id !== userId) return { ok: false, reason: "not_owner" }
	if (videoId === row.video_id) return { ok: false, reason: "cannot_unlink_primary" }

	await env.DB.prepare("DELETE FROM lyrics_video_ids WHERE lyrics_id = ? AND video_id = ?")
		.bind(lyricsId, videoId)
		.run()

	await invalidateCache(env, videoId)
	await invalidateCacheForLyric(env, lyricsId)

	return { ok: true, videos: await listVideoLinks(env, lyricsId) }
}
