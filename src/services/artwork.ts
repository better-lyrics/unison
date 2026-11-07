import { config } from "@/config"
import {
	type VideoSong,
	findSongForVideo,
	getVideoArtwork,
	touchArtwork,
	upsertVideoArtwork,
} from "@/db/artwork"
import { deezerCoverForIsrc } from "@/infra/deezer"
import { itunesCoverFor } from "@/infra/itunes"
import { log } from "@/infra/logger"
import {
	type ArtworkCover,
	NEGATIVE_CACHE_VALUE,
	readCachedCover,
	writeCachedCover,
} from "@/services/artwork-cache"
import { queueArtworkFallback } from "@/services/artwork-fallback"
import { type ArtworkImage, fetchImage, mirrorImage } from "@/services/artwork-store"
import type { Env } from "@/types"
import { isMirroredArtworkUrl, isServableArtworkUrl, normalizeArtworkUrl } from "@/utils/artwork"
import { squareFromThumbnail } from "@/utils/artwork-crop"
import { sharedInFlight } from "@/utils/in-flight"
import { videoArtwork } from "@/utils/innertube"
import sharp from "sharp"

const THUMBNAILS = ["maxresdefault", "hq720", "sddefault", "hqdefault"]
const MIN_THUMBNAIL_WIDTH = 480

export type ArtworkHit = { url: string } | { mirror: string } | { bytes: Buffer }

export interface ArtworkSource {
	name: string
	onRefresh: boolean
	/** Null is a miss; a throw means the source was unavailable, so a miss is not final. */
	find: (env: Env, videoId: string, song: VideoSong) => Promise<ArtworkHit | null>
}

export interface Resolution {
	url: string | null
	final: boolean
}

const OUT_OF_TIME: Resolution = { url: null, final: false }

export const ARTWORK_SOURCES: ArtworkSource[] = [
	{
		name: "youtube-music",
		onRefresh: true,
		find: async (env, videoId) => {
			const url = await cachedVideoArtwork(env, videoId)
			return url ? { url } : null
		},
	},
	{
		name: "deezer",
		onRefresh: false,
		find: async (_env, _videoId, { isrc, artist }) => {
			const cover = isrc ? await deezerCoverForIsrc(isrc, artist) : null
			return cover ? { mirror: cover } : null
		},
	},
	{
		name: "itunes",
		onRefresh: false,
		find: async (_env, _videoId, { song, artist }) => {
			const cover = await itunesCoverFor(song, artist)
			return cover ? { mirror: cover } : null
		},
	},
	{
		name: "video-thumbnail",
		onRefresh: false,
		find: async (_env, videoId) => {
			for (const name of THUMBNAILS) {
				const bytes = (await fetchImage(`https://i.ytimg.com/vi/${videoId}/${name}.jpg`))?.bytes
				if (!bytes) continue
				const { width = 0 } = await sharp(bytes).metadata()
				if (width < MIN_THUMBNAIL_WIDTH) continue
				const square = await squareFromThumbnail(bytes)
				return square ? { bytes: square } : null
			}
			return null
		},
	},
]

interface Deps {
	sources?: ArtworkSource[]
	random?: () => number
}

const youTubeMusicKey = (videoId: string) => `ytmart:v1:${videoId}`

async function cachedVideoArtwork(env: Env, videoId: string): Promise<string | null> {
	const cached = await env.CACHE.get(youTubeMusicKey(videoId))
	if (cached !== null) return cached === NEGATIVE_CACHE_VALUE ? null : cached
	const url = await videoArtwork(videoId)
	await env.CACHE.put(youTubeMusicKey(videoId), url ?? NEGATIVE_CACHE_VALUE, {
		expirationTtl: config.artwork.youTubeMusicTtlSeconds,
	})
	return url
}

async function hitUrl(env: Env, videoId: string, hit: ArtworkHit): Promise<string | null> {
	if ("url" in hit) return hit.url
	const image = "bytes" in hit ? hit.bytes : (await fetchImage(hit.mirror))?.bytes
	return image ? (await mirrorImage(env, videoId, image)).url : null
}

async function runSources(
	env: Env,
	videoId: string,
	sources: ArtworkSource[]
): Promise<Resolution> {
	const song = await findSongForVideo(env, videoId)
	if (!song) return { url: null, final: true }
	let final = true
	const deadline = Date.now() + config.artwork.resolveBudgetMs
	for (const source of sources) {
		if (Date.now() > deadline) return OUT_OF_TIME
		try {
			const hit = await source.find(env, videoId, song)
			const url = hit ? await hitUrl(env, videoId, hit) : null
			if (url) return { url, final }
		} catch (error) {
			final = false
			log.warn("artwork source failed", {
				source: source.name,
				videoId,
				error: (error as Error).message,
			})
		}
	}
	return { url: null, final }
}

const inflight = sharedInFlight<Resolution>()

function maybeRefresh(env: Env, videoId: string, sources: ArtworkSource[], random: () => number) {
	if (random() >= config.artwork.refreshProbability) return
	void (async () => {
		await touchArtwork(env, videoId)
		const fresh = await runSources(
			env,
			videoId,
			sources.filter((s) => s.onRefresh)
		)
		if (!fresh.url) return
		await upsertVideoArtwork(env, videoId, fresh.url)
		const stored = await getVideoArtwork(env, videoId)
		await writeCachedCover(env, videoId, {
			url: fresh.url,
			fallbackUrl: stored?.fallbackUrl ?? null,
		})
	})().catch((error) =>
		log.warn("artwork refresh failed", { videoId, error: (error as Error).message })
	)
}

function withinBudget(work: Promise<Resolution>): Promise<Resolution> {
	let timer: NodeJS.Timeout | undefined
	const timeout = new Promise<Resolution>((resolve) => {
		timer = setTimeout(() => resolve(OUT_OF_TIME), config.artwork.resolveBudgetMs)
	})
	return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

async function resolveCold(env: Env, videoId: string, sources: ArtworkSource[]) {
	const resolved = await withinBudget(runSources(env, videoId, sources))
	const cover = resolved.url ? { url: resolved.url, fallbackUrl: null } : null
	if (resolved.url || resolved.final) {
		await upsertVideoArtwork(env, videoId, resolved.url)
		await writeCachedCover(env, videoId, cover)
	} else {
		await writeCachedCover(env, videoId, null, config.artwork.incompleteTtlSeconds)
	}
	return resolved
}

export async function resolveArtworkCover(
	env: Env,
	videoId: string,
	deps: Deps = {}
): Promise<ArtworkCover | null> {
	const sources = deps.sources ?? ARTWORK_SOURCES
	const random = deps.random ?? Math.random

	const cached = await readCachedCover(env, videoId)
	if (cached !== undefined) {
		maybeRefresh(env, videoId, sources, random)
		if (cached && !cached.fallbackUrl) queueArtworkFallback(env, videoId, cached.url)
		return cached
	}

	const dbRow = await getVideoArtwork(env, videoId)
	if (dbRow?.artworkUrl) {
		const cover = { url: dbRow.artworkUrl, fallbackUrl: dbRow.fallbackUrl }
		await writeCachedCover(env, videoId, cover)
		maybeRefresh(env, videoId, sources, random)
		if (!cover.fallbackUrl) queueArtworkFallback(env, videoId, cover.url)
		return cover
	}

	const { url } = await inflight(videoId, () => resolveCold(env, videoId, sources))
	if (url) queueArtworkFallback(env, videoId, url)
	return url ? { url, fallbackUrl: null } : null
}

export async function resolveArtwork(
	env: Env,
	videoId: string,
	deps: Deps = {}
): Promise<string | null> {
	return (await resolveArtworkCover(env, videoId, deps))?.url ?? null
}

async function fetchSized(url: string, size: number): Promise<ArtworkImage | null> {
	if (!isServableArtworkUrl(url)) return null
	const image = await fetchImage(normalizeArtworkUrl(url, size))
	if (!image || !isMirroredArtworkUrl(url) || size >= config.artwork.size) return image
	const bytes = await sharp(image.bytes).resize(size, size).jpeg({ quality: 85 }).toBuffer()
	return { bytes, type: "image/jpeg" }
}

export async function fetchArtworkImage(
	cover: ArtworkCover,
	size: number
): Promise<ArtworkImage | null> {
	for (const url of [cover.url, cover.fallbackUrl]) {
		if (!url) continue
		try {
			const image = await fetchSized(url, size)
			if (image) return image
		} catch (error) {
			log.warn("artwork image failed", { url, error: (error as Error).message })
		}
	}
	return null
}
