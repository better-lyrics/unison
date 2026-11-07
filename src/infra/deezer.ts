import { config } from "@/config"
import { createCircuitBreaker } from "@/infra/outbound-limiter"
import { creditSharesArtist } from "@/utils/normalize"

const { deezer, breaker } = config.artwork
const circuit = createCircuitBreaker(breaker)
const VARIOUS_ARTISTS = "Various Artists"
const NO_DATA = 800

type Fields = Record<string, unknown>

async function get(path: string): Promise<Fields | null> {
	circuit.check()
	let res: Response
	try {
		res = await fetch(`${deezer.baseUrl}${path}`, { signal: AbortSignal.timeout(deezer.timeoutMs) })
	} catch (err) {
		circuit.recordFailure()
		throw err
	}
	if (!res.ok) {
		circuit.recordFailure()
		throw new Error(`deezer ${path} answered ${res.status}`)
	}
	const body = (await res.json()) as Fields
	const error = body.error as { code?: number; message?: string } | undefined
	if (error && error.code !== NO_DATA) {
		circuit.recordFailure()
		throw new Error(`deezer ${path} failed: ${error.message}`)
	}
	circuit.recordSuccess()
	return error ? null : body
}

const text = (value: unknown) => (typeof value === "string" ? value : "")
const field = (value: unknown, key: string) =>
	typeof value === "object" && value !== null ? (value as Fields)[key] : undefined

/** The release cover for an ISRC, refused when it belongs to another artist or a various artists compilation. */
export async function deezerCoverForIsrc(isrc: string, artist: string): Promise<string | null> {
	const track = await get(`/track/isrc:${encodeURIComponent(isrc)}`)
	if (!track || !creditSharesArtist(text(field(track.artist, "name")), artist)) return null
	const album = track.album
	if (!text(field(album, "md5_image"))) return null
	const cover = text(field(album, "cover_xl"))
	if (!cover.startsWith("https://")) return null

	const release = await get(`/album/${encodeURIComponent(String(field(album, "id")))}`)
	if (release && text(field(release.artist, "name")) === VARIOUS_ARTISTS) return null
	return cover
}
