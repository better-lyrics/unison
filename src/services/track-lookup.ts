import { config } from "@/config"
import { findByIsrc, findBySongArtist, findByVideoId } from "@/db/lyrics"
import { lookupIsrcVideo, pauseRemainingSec, resolveProviderIds } from "@/infra/binilink"
import type { Env, LyricsRow } from "@/types"
import { normalizeIsrc } from "@/utils/isrc"
import type { ProviderId } from "@/utils/provider-id"

const MISS = "__none__"
const PENDING = "__pending__"
const trackKey = (id: ProviderId) => `binilink:${id.service}:${id.id}`
const videoKey = (isrc: string) => `binilink:isrc:${isrc}`

export type MatchedBy = "isrc" | "linked_video" | "song_artist"

type Resolution = (
	| { kind: "isrc"; isrc: string }
	| { kind: "missing" }
	| { kind: "pending"; retryAfterSec: number }
) & { calledBinilink: boolean }

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
	const known = cached.find((value) => value !== null && value !== MISS && value !== PENDING)
	if (known) return { kind: "isrc", isrc: known, calledBinilink: false }

	const pending = { kind: "pending", retryAfterSec: config.binilink.pendingRetryAfterSec } as const
	const uncached = ids.filter((_, i) => cached[i] === null)
	if (uncached.length === 0) {
		return cached.includes(PENDING)
			? { ...pending, calledBinilink: false }
			: { kind: "missing", calledBinilink: false }
	}

	const batch = await resolveProviderIds(uncached)
	if (!batch) {
		return {
			kind: "pending",
			retryAfterSec: pauseRemainingSec() || config.binilink.pendingRetryAfterSec,
			calledBinilink: true,
		}
	}

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
		...batch.pending.map((id) =>
			env.CACHE.put(trackKey(id), PENDING, {
				expirationTtl: config.binilink.pendingRetryAfterSec,
			})
		),
	])

	for (const id of ids) {
		const hit = batch.results.find((r) => r.service === id.service && r.id === id.id)
		if (hit) return { kind: "isrc", isrc: hit.isrc, calledBinilink: true }
	}
	return batch.pending.length > 0 || cached.includes(PENDING)
		? { ...pending, calledBinilink: true }
		: { kind: "missing", calledBinilink: true }
}

async function linkedVideo(
	env: Env,
	isrc: string,
	canFetch: boolean
): Promise<{ videoId: string | null; fetched: boolean }> {
	const cached = await env.CACHE.get(videoKey(isrc))
	if (cached === MISS || cached === PENDING) return { videoId: null, fetched: false }
	if (cached !== null) return { videoId: cached, fetched: false }
	if (!canFetch) return { videoId: null, fetched: false }

	const result = await lookupIsrcVideo(isrc)
	if (!result) return { videoId: null, fetched: true }
	if (result.kind === "pending") {
		await env.CACHE.put(videoKey(isrc), PENDING, {
			expirationTtl: config.binilink.pendingRetryAfterSec,
		})
		return { videoId: null, fetched: true }
	}
	const videoId = result.kind === "found" ? result.videoId : null
	await env.CACHE.put(videoKey(isrc), videoId ?? MISS, {
		expirationTtl: config.binilink.videoTtlSec,
	})
	return { videoId, fetched: true }
}

/** Lookup order: given ISRC, resolved ISRC, song and artist, then BiniLink's video for either ISRC. At most one BiniLink call per request. */
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
	let calledBinilink = false
	if (enabled && query.providerIds.length > 0) {
		const resolved = await resolveProviderIsrc(env, query.providerIds)
		calledBinilink = resolved.calledBinilink
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
			const { videoId, fetched } = await linkedVideo(env, isrc, !calledBinilink)
			calledBinilink ||= fetched
			const row = videoId ? await findByVideoId(env, videoId) : null
			if (row) return { kind: "found", row, matchedBy: "linked_video" }
		}
	}
	return retryAfterSec !== null ? { kind: "pending", retryAfterSec } : { kind: "none" }
}
