import { config } from "@/config"
import { findByIsrc, findBySongArtist, findByVideoId } from "@/db/lyrics"
import { lookupIsrcVideo, pauseRemainingSec, resolveProviderIds } from "@/infra/binilink"
import type { Env, LyricsRow } from "@/types"
import { normalizeIsrc } from "@/utils/isrc"
import type { ProviderId } from "@/utils/provider-id"

const MISS = "__none__"
const trackKey = (id: ProviderId) => `binilink:${id.service}:${id.id}`
const videoKey = (isrc: string) => `binilink:isrc:${isrc}`

export type MatchedBy = "isrc" | "linked_video" | "song_artist"

type Resolution =
	| { kind: "isrc"; isrc: string }
	| { kind: "missing" }
	| { kind: "pending"; retryAfterSec: number }

export type TrackMatch =
	| { kind: "found"; row: LyricsRow; matchedBy: MatchedBy }
	| { kind: "pending"; retryAfterSec: number }
	| { kind: "none" }

export type TrackQuery = {
	isrc?: string
	providerIds: ProviderId[]
	song?: string
	artist?: string
	album?: string
	duration?: number
}

export async function resolveProviderIsrc(env: Env, ids: ProviderId[]): Promise<Resolution> {
	const cached = await Promise.all(ids.map((id) => env.CACHE.get(trackKey(id))))
	const uncached = ids.filter((_, i) => cached[i] === null)
	const batch = uncached.length > 0 ? await resolveProviderIds(uncached) : null

	if (batch) {
		await Promise.all([
			...batch.results.map((r) =>
				env.CACHE.put(trackKey(r), r.isrc, { expirationTtl: config.binilink.trackTtlSec })
			),
			...batch.results.map((r) =>
				env.CACHE.put(videoKey(r.isrc), r.youtube ?? MISS, {
					expirationTtl: config.binilink.videoTtlSec,
				})
			),
			...batch.missing.map((id) =>
				env.CACHE.put(trackKey(id), MISS, { expirationTtl: config.binilink.missTtlSec })
			),
		])
	}

	for (const [i, id] of ids.entries()) {
		const isrc =
			cached[i] ?? batch?.results.find((r) => r.service === id.service && r.id === id.id)?.isrc
		if (isrc && isrc !== MISS) return { kind: "isrc", isrc }
	}
	if (uncached.length === 0) return { kind: "missing" }
	if (!batch) {
		return {
			kind: "pending",
			retryAfterSec: pauseRemainingSec() || config.binilink.pendingRetryAfterSec,
		}
	}
	return batch.pending.length > 0
		? { kind: "pending", retryAfterSec: config.binilink.pendingRetryAfterSec }
		: { kind: "missing" }
}

async function linkedVideo(env: Env, isrc: string): Promise<string | null> {
	const cached = await env.CACHE.get(videoKey(isrc))
	if (cached !== null) return cached === MISS ? null : cached

	const result = await lookupIsrcVideo(isrc)
	if (!result || result.kind === "pending") return null
	const videoId = result.kind === "found" ? result.videoId : null
	await env.CACHE.put(videoKey(isrc), videoId ?? MISS, {
		expirationTtl: config.binilink.videoTtlSec,
	})
	return videoId
}

/** Lookup order: given ISRC, resolved ISRC, song and artist, then BiniLink's video for either ISRC. */
export async function findLyricsByTrack(env: Env, query: TrackQuery): Promise<TrackMatch> {
	const enabled = env.BINILINK_LOOKUP_ENABLED === true
	const isrcs: string[] = []
	const given = query.isrc ? normalizeIsrc(query.isrc) : null
	if (given) {
		const row = await findByIsrc(env, given)
		if (row) return { kind: "found", row, matchedBy: "isrc" }
		isrcs.push(given)
	}

	let retryAfterSec: number | null = null
	if (enabled && query.providerIds.length > 0) {
		const resolved = await resolveProviderIsrc(env, query.providerIds)
		if (resolved.kind === "pending") retryAfterSec = resolved.retryAfterSec
		if (resolved.kind === "isrc" && resolved.isrc !== given) {
			const row = await findByIsrc(env, resolved.isrc)
			if (row) return { kind: "found", row, matchedBy: "isrc" }
			isrcs.push(resolved.isrc)
		}
	}

	if (query.song && query.artist) {
		const row = await findBySongArtist(env, query.song, query.artist, query.duration, query.album)
		if (row) return { kind: "found", row, matchedBy: "song_artist" }
	}
	if (enabled) {
		for (const isrc of isrcs) {
			const videoId = await linkedVideo(env, isrc)
			const row = videoId ? await findByVideoId(env, videoId) : null
			if (row) return { kind: "found", row, matchedBy: "linked_video" }
		}
	}
	return retryAfterSec !== null ? { kind: "pending", retryAfterSec } : { kind: "none" }
}
