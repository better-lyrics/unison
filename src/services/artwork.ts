import { config } from "@/config"
import { getVideoArtwork, upsertVideoArtwork } from "@/db/artwork"
import type { Env } from "@/types"
import { getSquareArtworkUrl } from "@/utils/innertube"

const NEGATIVE = "__none__"
const key = (videoId: string) => `artwork:${videoId}`

interface Deps {
	resolver?: (videoId: string) => Promise<string | null>
	random?: () => number
}

function ttl(url: string | null): number {
	return url ? config.artwork.positiveTtlSeconds : config.artwork.negativeTtlSeconds
}

async function writeCache(env: Env, videoId: string, url: string | null): Promise<void> {
	await env.CACHE.put(key(videoId), url ?? NEGATIVE, { expirationTtl: ttl(url) })
}

function maybeRefresh(env: Env, videoId: string, deps: Required<Deps>): void {
	if (deps.random() >= config.artwork.refreshProbability) return
	void (async () => {
		const fresh = await deps.resolver(videoId)
		await upsertVideoArtwork(env, videoId, fresh)
		await writeCache(env, videoId, fresh)
	})().catch(() => {})
}

export async function resolveArtwork(
	env: Env,
	videoId: string,
	deps: Deps = {}
): Promise<string | null> {
	const d: Required<Deps> = {
		resolver: deps.resolver ?? getSquareArtworkUrl,
		random: deps.random ?? Math.random,
	}

	const cached = await env.CACHE.get(key(videoId))
	if (cached !== null) {
		maybeRefresh(env, videoId, d)
		return cached === NEGATIVE ? null : cached
	}

	const dbRow = await getVideoArtwork(env, videoId)
	if (dbRow) {
		await writeCache(env, videoId, dbRow.artworkUrl)
		maybeRefresh(env, videoId, d)
		return dbRow.artworkUrl
	}

	const resolved = await d.resolver(videoId)
	await upsertVideoArtwork(env, videoId, resolved)
	await writeCache(env, videoId, resolved)
	return resolved
}
