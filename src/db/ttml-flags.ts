import { config } from "@/config"
import type { Env } from "@/types"
import { decompress, isCompressed } from "@/utils/compression"
import { ttmlSignals } from "@/utils/ttml-signals"

export async function ttmlFlagsFor(
	env: Env,
	lyricsId: number,
	revisionId: number | null,
	content: string
): Promise<string[]> {
	const key = `ttml-flags:${lyricsId}:${revisionId ?? "base"}`
	const cached = await env.CACHE.get(key)
	if (cached) {
		try {
			return JSON.parse(cached) as string[]
		} catch {
			await env.CACHE.delete(key)
		}
	}
	let flags: string[]
	try {
		flags = ttmlSignals(isCompressed(content) ? await decompress(content) : content)
	} catch {
		return []
	}
	await env.CACHE.put(key, JSON.stringify(flags), {
		expirationTtl: config.council.flagsCacheTtlSec,
	})
	return flags
}
