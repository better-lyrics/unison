import { config } from "@/config"
import type { Env } from "@/types"
import { type SongCandidate, getVideoCandidate, searchSongs } from "@/utils/innertube"
import { normalizeArtist, normalizeSong } from "@/utils/normalize"

export type SongSearch = (query: string) => Promise<SongCandidate[]>
export type VideoLookup = (videoId: string) => Promise<SongCandidate | null>
type SongQuery = { song: string; artist: string }

export async function cachedSongSearch(
	env: Env,
	{ song, artist }: SongQuery,
	search: SongSearch = searchSongs
): Promise<SongCandidate[]> {
	const key = `songsearch:v5:${normalizeSong(song)}|${normalizeArtist(artist)}`
	const cached = await env.CACHE.get(key)
	if (cached) {
		try {
			return JSON.parse(cached) as SongCandidate[]
		} catch {
			await env.CACHE.delete(key)
		}
	}
	const results = await search(`${song} ${artist}`)
	const expirationTtl =
		results.length > 0
			? config.videoLinking.suggestionCacheTtlSeconds
			: config.videoLinking.emptySuggestionCacheTtlSeconds
	await env.CACHE.put(key, JSON.stringify(results), { expirationTtl })
	return results
}

export async function findSongCandidate(
	env: Env,
	query: SongQuery,
	videoId: string,
	search: SongSearch = searchSongs
): Promise<SongCandidate | null> {
	const candidates = await cachedSongSearch(env, query, search)
	return candidates.find((c) => c.videoId === videoId) ?? null
}

// One video's details, for a linked video the song search never returned.
export async function cachedVideoCandidate(
	env: Env,
	videoId: string,
	lookup: VideoLookup = getVideoCandidate
): Promise<SongCandidate | null> {
	const key = `videoinfo:v1:${videoId}`
	const cached = await env.CACHE.get(key)
	if (cached) {
		try {
			return JSON.parse(cached) as SongCandidate | null
		} catch {
			await env.CACHE.delete(key)
		}
	}
	const found = await lookup(videoId)
	const expirationTtl = found
		? config.videoLinking.videoDetailsCacheTtlSeconds
		: config.videoLinking.emptySuggestionCacheTtlSeconds
	await env.CACHE.put(key, JSON.stringify(found), { expirationTtl })
	return found
}
