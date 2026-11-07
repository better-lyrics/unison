import { config } from "@/config"
import { createCircuitBreaker } from "@/infra/outbound-limiter"
import { creditSharesArtist, normalizeSong } from "@/utils/normalize"

const { itunes, breaker, mirrorMaxSide } = config.artwork
const circuit = createCircuitBreaker(breaker)
const THUMB_SIZE = /\/100x100bb\./

type Track = { trackName?: unknown; artistName?: unknown; artworkUrl100?: unknown }

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
	circuit.recordSuccess()
	const { results } = (await res.json()) as { results?: Track[] }
	const wanted = normalizeSong(song)
	for (const track of results ?? []) {
		const { trackName, artistName, artworkUrl100 } = track
		if (typeof trackName !== "string" || typeof artistName !== "string") continue
		if (typeof artworkUrl100 !== "string" || !THUMB_SIZE.test(artworkUrl100)) continue
		if (normalizeSong(trackName) !== wanted || !creditSharesArtist(artistName, artist)) continue
		return artworkUrl100.replace(THUMB_SIZE, `/${mirrorMaxSide}x${mirrorMaxSide}bb.`)
	}
	return null
}
