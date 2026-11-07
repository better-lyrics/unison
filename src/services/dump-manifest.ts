import { log } from "@/infra/logger"
import type { DumpManifest } from "@/jobs/dump"
import type { Env } from "@/types"

const FETCH_TIMEOUT_MS = 3000
const STATS_KEY = "dump:stats"
const STATS_TTL_SECONDS = 60 * 60
const MISS_TTL_SECONDS = 60

export type DumpStats = { lyrics: number; requested: number; bytes: number }

export async function readDumpStats(env: Env): Promise<DumpStats | null> {
	if (!env.DUMP_PUBLIC_BASE_URL) return null
	const hit = await env.CACHE.get(STATS_KEY)
	if (hit !== null) return JSON.parse(hit)
	const stats = await fetchDumpStats(env.DUMP_PUBLIC_BASE_URL)
	await env.CACHE.put(STATS_KEY, JSON.stringify(stats), {
		expirationTtl: stats ? STATS_TTL_SECONDS : MISS_TTL_SECONDS,
	})
	return stats
}

async function fetchDumpStats(base: string): Promise<DumpStats | null> {
	const url = `${base}/dumps/manifest.json`
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
		if (!res.ok) {
			log.warn("dump manifest rejected", { url, status: res.status })
			return null
		}
		const manifest = (await res.json()) as Partial<DumpManifest>
		const lyrics = manifest.row_counts?.lyrics
		const requested = manifest.row_counts?.requested_songs
		const bytes = manifest.bytes
		if (![lyrics, requested, bytes].every(Number.isFinite)) return null
		return { lyrics: Number(lyrics), requested: Number(requested), bytes: Number(bytes) }
	} catch (error) {
		log.warn("dump manifest failed", { url, error: (error as Error).message })
		return null
	}
}
