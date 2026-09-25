import { config } from "@/config"
import { findSongForVideo, getVideoArtwork, upsertVideoArtwork } from "@/db/artwork"
import { type SongSearch, findSongCandidate } from "@/services/song-search"
import type { Env } from "@/types"

const NEGATIVE = "__none__"
const key = (videoId: string) => `artwork:v2:${videoId}`

interface Deps {
	resolver?: (videoId: string) => Promise<string | null>
	search?: SongSearch
	random?: () => number
}

type Resolved = { resolver: NonNullable<Deps["resolver"]>; random: () => number }

function ttl(url: string | null): number {
	return url ? config.artwork.positiveTtlSeconds : config.artwork.negativeTtlSeconds
}

async function writeCache(env: Env, videoId: string, url: string | null): Promise<void> {
	await env.CACHE.put(key(videoId), url ?? NEGATIVE, { expirationTtl: ttl(url) })
}

function maybeRefresh(env: Env, videoId: string, deps: Resolved): void {
	if (deps.random() >= config.artwork.refreshProbability) return
	void (async () => {
		const fresh = await deps.resolver(videoId)
		if (!fresh) return
		await upsertVideoArtwork(env, videoId, fresh)
		await writeCache(env, videoId, fresh)
	})().catch(() => {})
}

async function searchArtwork(
	env: Env,
	videoId: string,
	search: SongSearch | undefined
): Promise<string | null> {
	const song = await findSongForVideo(env, videoId)
	if (!song) return null
	const hit = await findSongCandidate(env, song, videoId, search)
	return hit?.artworkUrl ?? null
}

export async function resolveArtwork(
	env: Env,
	videoId: string,
	deps: Deps = {}
): Promise<string | null> {
	const d: Resolved = {
		resolver: deps.resolver ?? ((id) => searchArtwork(env, id, deps.search)),
		random: deps.random ?? Math.random,
	}

	const cached = await env.CACHE.get(key(videoId))
	if (cached !== null) {
		maybeRefresh(env, videoId, d)
		return cached === NEGATIVE ? null : cached
	}

	const dbRow = await getVideoArtwork(env, videoId)
	if (dbRow?.artworkUrl) {
		await writeCache(env, videoId, dbRow.artworkUrl)
		maybeRefresh(env, videoId, d)
		return dbRow.artworkUrl
	}

	const resolved = await d.resolver(videoId)
	await upsertVideoArtwork(env, videoId, resolved)
	await writeCache(env, videoId, resolved)
	return resolved
}
