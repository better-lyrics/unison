import { createHash } from "node:crypto"
import { config } from "@/config"
import { type VideoSong, findSongForVideo, getVideoArtwork, upsertVideoArtwork } from "@/db/artwork"
import { deezerCoverForIsrc } from "@/infra/deezer"
import { itunesCoverFor } from "@/infra/itunes"
import { log } from "@/infra/logger"
import type { Env } from "@/types"
import { isMirroredArtworkUrl, isServableArtworkUrl, normalizeArtworkUrl } from "@/utils/artwork"
import { squareFromThumbnail } from "@/utils/artwork-crop"
import { sharedInFlight } from "@/utils/in-flight"
import { videoArtwork } from "@/utils/innertube"
import sharp from "sharp"

const NEGATIVE = "__none__"
export const artworkCacheKey = (videoId: string) => `artwork:v3:${videoId}`
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
	if (cached !== null) return cached === NEGATIVE ? null : cached
	const url = await videoArtwork(videoId)
	await env.CACHE.put(youTubeMusicKey(videoId), url ?? NEGATIVE, {
		expirationTtl: config.videoLinking.suggestionCacheTtlSeconds,
	})
	return url
}

async function fetchImage(url: string): Promise<{ bytes: Buffer; type: string } | null> {
	const res = await fetch(url, { signal: AbortSignal.timeout(config.artwork.fetchTimeoutMs) })
	if (res.status === 404) return null
	if (!res.ok) throw new Error(`image ${url} answered ${res.status}`)
	const type = res.headers.get("content-type") ?? ""
	if (!type.startsWith("image/")) throw new Error(`image ${url} is ${type || "untyped"}`)
	if (Number(res.headers.get("content-length")) > config.artwork.maxImageBytes) {
		throw new Error(`image ${url} is too large`)
	}
	const bytes = Buffer.from(await res.arrayBuffer())
	if (bytes.length > config.artwork.maxImageBytes) throw new Error(`image ${url} is too large`)
	return { bytes, type }
}

async function mirror(env: Env, videoId: string, image: Buffer): Promise<string> {
	if (!env.CDN) throw new Error("artwork CDN is not configured")
	const side = config.artwork.size
	const jpeg = await sharp(image)
		.resize(side, side, { fit: "cover", withoutEnlargement: true })
		.jpeg({ quality: 85 })
		.toBuffer()
	const hash = createHash("sha256").update(jpeg).digest("hex").slice(0, 16)
	const file = `${videoId}-${hash}.jpg`
	await env.CDN.putObject(
		config.artwork.cdnKeyPrefix + file,
		jpeg,
		"image/jpeg",
		jpeg.length,
		config.artwork.cdnCacheControl
	)
	return config.artwork.cdnBase + file
}

async function hitUrl(env: Env, videoId: string, hit: ArtworkHit): Promise<string | null> {
	if ("url" in hit) return hit.url
	const image = "bytes" in hit ? hit.bytes : (await fetchImage(hit.mirror))?.bytes
	return image ? mirror(env, videoId, image) : null
}

async function runSources(
	env: Env,
	videoId: string,
	sources: ArtworkSource[]
): Promise<Resolution> {
	const song = await findSongForVideo(env, videoId)
	if (!song) return { url: null, final: true }
	let final = true
	for (const source of sources) {
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

function ttl(url: string | null): number {
	return url ? config.artwork.positiveTtlSeconds : config.artwork.negativeTtlSeconds
}

async function writeCache(env: Env, videoId: string, url: string | null, seconds = ttl(url)) {
	await env.CACHE.put(artworkCacheKey(videoId), url ?? NEGATIVE, { expirationTtl: seconds })
}

function maybeRefresh(env: Env, videoId: string, sources: ArtworkSource[], random: () => number) {
	if (random() >= config.artwork.refreshProbability) return
	void (async () => {
		const fresh = await runSources(
			env,
			videoId,
			sources.filter((s) => s.onRefresh)
		)
		if (!fresh.url) return
		await upsertVideoArtwork(env, videoId, fresh.url)
		await writeCache(env, videoId, fresh.url)
	})().catch((error) =>
		log.warn("artwork refresh failed", { videoId, error: (error as Error).message })
	)
}

async function resolveCold(env: Env, videoId: string, sources: ArtworkSource[]) {
	const resolved = await runSources(env, videoId, sources)
	if (resolved.url || resolved.final) {
		await upsertVideoArtwork(env, videoId, resolved.url)
		await writeCache(env, videoId, resolved.url)
	} else {
		await writeCache(env, videoId, null, config.artwork.incompleteTtlSeconds)
	}
	return resolved
}

export async function resolveArtwork(
	env: Env,
	videoId: string,
	deps: Deps = {}
): Promise<string | null> {
	const sources = deps.sources ?? ARTWORK_SOURCES
	const random = deps.random ?? Math.random

	const cached = await env.CACHE.get(artworkCacheKey(videoId))
	if (cached !== null) {
		maybeRefresh(env, videoId, sources, random)
		return cached === NEGATIVE ? null : cached
	}

	const dbRow = await getVideoArtwork(env, videoId)
	if (dbRow?.artworkUrl) {
		await writeCache(env, videoId, dbRow.artworkUrl)
		maybeRefresh(env, videoId, sources, random)
		return dbRow.artworkUrl
	}

	return (await inflight(videoId, () => resolveCold(env, videoId, sources))).url
}

export interface ArtworkImage {
	bytes: Buffer
	type: string
}

export async function fetchArtworkImage(url: string, size: number): Promise<ArtworkImage | null> {
	if (!isServableArtworkUrl(url)) return null
	const sized = normalizeArtworkUrl(url, size)
	try {
		const image = await fetchImage(sized)
		if (!image) {
			log.warn("artwork image missing", { url: sized })
			return null
		}
		if (!isMirroredArtworkUrl(url) || size >= config.artwork.size) return image
		const bytes = await sharp(image.bytes).resize(size, size).jpeg({ quality: 85 }).toBuffer()
		return { bytes, type: "image/jpeg" }
	} catch (error) {
		log.warn("artwork image failed", { url: sized, error: (error as Error).message })
		return null
	}
}
