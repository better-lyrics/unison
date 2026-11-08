import { config } from "@/config"
import {
	artworkWithoutFallback,
	clearArtworkFallback,
	fallbackBytesTotal,
	isArtworkUncopyable,
	leastServedFallbacks,
	markArtworkUncopyable,
	setArtworkFallback,
} from "@/db/artwork"
import { log } from "@/infra/logger"
import { UpstreamRateLimitedError, createCircuitBreaker } from "@/infra/outbound-limiter"
import { artworkCacheKey, writeCachedCover } from "@/services/artwork-cache"
import { deleteMirroredImage, fetchImage, mirrorImage } from "@/services/artwork-store"
import type { Env } from "@/types"
import { isAlbumArtUrl } from "@/utils/artwork"
import sharp from "sharp"

const { fallback } = config.artwork
const google = createCircuitBreaker(config.artwork.breaker)
const queue = new Map<string, { env: Env; artworkUrl: string }>()
let draining = false

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function isTransient(error: unknown): boolean {
	const message = (error as Error).message
	if (!message.startsWith("image ")) return true
	const status = Number(message.match(/answered (\d+)$/)?.[1])
	return status === 429 || status >= 500
}

async function giveUp(env: Env, videoId: string, artworkUrl: string): Promise<void> {
	if (await markArtworkUncopyable(env, videoId, artworkUrl)) {
		await writeCachedCover(env, videoId, { url: artworkUrl, fallbackUrl: null, uncopyable: true })
	}
}

async function decodes(bytes: Buffer): Promise<boolean> {
	try {
		await sharp(bytes).resize(8, 8).raw().toBuffer()
		return true
	} catch {
		return false
	}
}

type CopyResult = "copied" | "failed" | "skipped"

async function copyCover(env: Env, videoId: string, artworkUrl: string): Promise<CopyResult> {
	if (await isArtworkUncopyable(env, videoId, artworkUrl)) return "skipped"
	google.check()
	let image: Awaited<ReturnType<typeof fetchImage>>
	try {
		image = await fetchImage(artworkUrl)
	} catch (error) {
		if (isTransient(error)) {
			google.recordFailure()
			if ((error as Error).message.endsWith("answered 429")) throw new UpstreamRateLimitedError()
			throw error
		}
		await giveUp(env, videoId, artworkUrl)
		throw error
	}
	google.recordSuccess()
	if (!image || !(await decodes(image.bytes))) {
		await giveUp(env, videoId, artworkUrl)
		return "failed"
	}
	const mirrored = await mirrorImage(env, videoId, image.bytes)
	if (await setArtworkFallback(env, videoId, artworkUrl, mirrored.url, mirrored.bytes)) {
		await env.CACHE.delete(artworkCacheKey(videoId))
	} else {
		await deleteMirroredImage(env, mirrored.url)
	}
	return "copied"
}

async function drain(): Promise<void> {
	if (draining) return
	draining = true
	try {
		for (const [videoId, job] of queue) {
			queue.delete(videoId)
			try {
				if ((await copyCover(job.env, videoId, job.artworkUrl)) === "skipped") continue
			} catch (error) {
				if (error instanceof UpstreamRateLimitedError) {
					queue.clear()
					return
				}
				log.warn("artwork fallback copy failed", { videoId, error: (error as Error).message })
			}
			await sleep(fallback.gapMs)
		}
	} finally {
		draining = false
	}
}

export function queueArtworkFallback(env: Env, videoId: string, artworkUrl: string): void {
	if (!env.CDN || !isAlbumArtUrl(artworkUrl)) return
	if (queue.has(videoId) || queue.size >= fallback.maxQueue) return
	queue.set(videoId, { env, artworkUrl })
	void drain()
}

export async function backfillArtworkFallbacks(env: Env): Promise<{ copied: number }> {
	if (!env.CDN) return { copied: 0 }
	let copied = 0
	let after = ""
	while (true) {
		const rows = await artworkWithoutFallback(env, after, fallback.backfillBatch)
		if (rows.length === 0) break
		for (const row of rows) {
			after = row.videoId
			if ((await copyWithRetry(env, row.videoId, row.artworkUrl)) === "copied") copied++
			await sleep(fallback.gapMs)
		}
	}
	return { copied }
}

async function copyWithRetry(env: Env, videoId: string, artworkUrl: string): Promise<CopyResult> {
	while (true) {
		try {
			return await copyCover(env, videoId, artworkUrl)
		} catch (error) {
			if (error instanceof UpstreamRateLimitedError) {
				await sleep(config.artwork.breaker.baseOpenMs)
				continue
			}
			log.warn("artwork fallback backfill failed", { videoId, error: (error as Error).message })
			return "failed"
		}
	}
}

export async function evictArtworkFallbacks(env: Env): Promise<{ evicted: number }> {
	if (!env.CDN) return { evicted: 0 }
	let total = await fallbackBytesTotal(env)
	let evicted = 0
	while (total > fallback.capBytes) {
		const rows = await leastServedFallbacks(env, fallback.evictBatch)
		if (rows.length === 0) break
		for (const row of rows) {
			if (total <= fallback.capBytes) break
			await clearArtworkFallback(env, row.videoId, row.fallbackUrl)
			await deleteMirroredImage(env, row.fallbackUrl)
			await env.CACHE.delete(artworkCacheKey(row.videoId))
			total -= row.bytes
			evicted++
		}
	}
	return { evicted }
}
