import { config } from "@/config"
import { createCircuitBreaker } from "@/infra/outbound-limiter"
import { creditSharesArtist, normalizeSong } from "@/utils/normalize"

const { itunes, breaker, size } = config.artwork
const circuit = createCircuitBreaker(breaker)
const THUMB_SIZE = /\/100x100bb\./
const COVER_HOST = /^is\d+-ssl\.mzstatic\.com$/

type Track = { trackName?: unknown; artistName?: unknown; artworkUrl100?: unknown }

function isItunesCover(url: string): boolean {
	try {
		const parsed = new URL(url)
		return parsed.protocol === "https:" && COVER_HOST.test(parsed.hostname) && THUMB_SIZE.test(url)
	} catch {
		return false
	}
}

export async function itunesCoverFor(song: string, artist: string): Promise<string | null> {
	circuit.check()
	const params = new URLSearchParams({
		term: `${song} ${artist}`,
		entity: "song",
		limit: "5",
		country: itunes.country,
	})
	let res: Response
	try {
		res = await fetch(`${itunes.baseUrl}/search?${params}`, {
			signal: AbortSignal.timeout(itunes.timeoutMs),
		})
	} catch (err) {
		circuit.recordFailure()
		throw err
	}
	if (!res.ok) {
		circuit.recordFailure()
		throw new Error(`itunes search answered ${res.status}`)
	}
	let results: Track[] | undefined
	try {
		results = ((await res.json()) as { results?: Track[] }).results
	} catch (err) {
		circuit.recordFailure()
		throw err
	}
	circuit.recordSuccess()
	const wanted = normalizeSong(song)
	for (const track of results ?? []) {
		const { trackName, artistName, artworkUrl100 } = track
		if (typeof trackName !== "string" || typeof artistName !== "string") continue
		if (typeof artworkUrl100 !== "string" || !isItunesCover(artworkUrl100)) continue
		if (normalizeSong(trackName) !== wanted || !creditSharesArtist(artistName, artist)) continue
		return artworkUrl100.replace(THUMB_SIZE, `/${size}x${size}bb.`)
	}
	return null
}
