import { config } from "@/config"
import type { Env } from "@/types"

export interface ArtworkCover {
	url: string
	fallbackUrl: string | null
}

export const NEGATIVE_CACHE_VALUE = "__none__"

export const artworkCacheKey = (videoId: string) => `artwork:v3:${videoId}`

/** Undefined is a cache miss, null a cached "no cover". Plain url values predate fallbacks. */
export async function readCachedCover(
	env: Env,
	videoId: string
): Promise<ArtworkCover | null | undefined> {
	const raw = await env.CACHE.get(artworkCacheKey(videoId))
	if (raw === null) return undefined
	if (raw === NEGATIVE_CACHE_VALUE) return null
	if (!raw.startsWith("{")) return { url: raw, fallbackUrl: null }
	try {
		const parsed = JSON.parse(raw) as Partial<ArtworkCover>
		return typeof parsed.url === "string"
			? { url: parsed.url, fallbackUrl: parsed.fallbackUrl ?? null }
			: undefined
	} catch {
		return undefined
	}
}

export async function writeCachedCover(
	env: Env,
	videoId: string,
	cover: ArtworkCover | null,
	seconds = cover ? config.artwork.positiveTtlSeconds : config.artwork.negativeTtlSeconds
): Promise<void> {
	const value = cover
		? cover.fallbackUrl
			? JSON.stringify(cover)
			: cover.url
		: NEGATIVE_CACHE_VALUE
	await env.CACHE.put(artworkCacheKey(videoId), value, { expirationTtl: seconds })
}
