import { Logger } from "@/infra/logger"
import type { Env } from "@/types"

const log = new Logger("blyrics-api")

const BATCH_SIZE = 500
const TIMEOUT_MS = 5000

/**
 * Tells the Better Lyrics API that what Unison serves for these videos may have changed, so it can
 * drop its shared copy. Fire-and-forget: a missed call only leaves the Better Lyrics copy stale
 * until its own TTL, and its live lookup corrects the client on the same request.
 */
export function notifyLyricsInvalidated(env: Env, videoIds: readonly string[]): void {
	const target = env.BLYRICS_API_INVALIDATE
	if (!target || videoIds.length === 0) return

	const unique = [...new Set(videoIds)]
	for (let i = 0; i < unique.length; i += BATCH_SIZE) {
		const batch = unique.slice(i, i + BATCH_SIZE)
		fetch(target.url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${target.secret}`,
			},
			body: JSON.stringify({ videoIds: batch }),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		})
			.then((res) => {
				if (!res.ok) log.warn("invalidate rejected", { status: res.status, count: batch.length })
			})
			.catch((err) => {
				log.warn("invalidate failed", { error: (err as Error).message, count: batch.length })
			})
	}
}
