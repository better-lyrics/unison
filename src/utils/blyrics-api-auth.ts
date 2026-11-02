import { timingSafeEqual } from "node:crypto"
import type { Env } from "@/types"

/** Header the Better Lyrics API sends on server-to-server calls. */
export const BLYRICS_API_KEY_HEADER = "x-blyrics-api-key"

/** Whether a request comes from the Better Lyrics API, which proxies many users from a few IPs. */
export function isBlyricsApiRequest(
	headers: Record<string, string | undefined>,
	env: Env
): boolean {
	const secret = env.BLYRICS_API_KEY
	const provided = headers[BLYRICS_API_KEY_HEADER]
	if (!secret || !provided) return false
	const a = Buffer.from(provided)
	const b = Buffer.from(secret)
	return a.length === b.length && timingSafeEqual(a, b)
}
