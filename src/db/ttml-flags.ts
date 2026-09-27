import { config } from "@/config"
import type { Env } from "@/types"
import { decompress, isCompressed } from "@/utils/compression"
import { SIGNALS_VERSION, ttmlSignals } from "@/utils/ttml-signals"

export async function ttmlFlagsFor(
	env: Env,
	lyricsId: number,
	revisionId: number | null
): Promise<string[]> {
	const key = `ttml-flags:v${SIGNALS_VERSION}:${lyricsId}:${revisionId ?? "base"}`
	const cached = await env.CACHE.get(key)
	if (cached) {
		try {
			return JSON.parse(cached) as string[]
		} catch {
			await env.CACHE.delete(key)
		}
	}
	const row = await env.DB.prepare("SELECT lyrics FROM lyrics WHERE id = ?")
		.bind(lyricsId)
		.first<{ lyrics: string }>()
	if (!row) return []
	let flags: string[]
	try {
		flags = ttmlSignals(isCompressed(row.lyrics) ? await decompress(row.lyrics) : row.lyrics)
	} catch {
		return []
	}
	await env.CACHE.put(key, JSON.stringify(flags), {
		expirationTtl: config.council.flagsCacheTtlSec,
	})
	return flags
}
