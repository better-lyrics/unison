import { config } from "@/config"
import { isValidAlbum } from "@/utils/album"
import { isVideoId } from "@/utils/video-id"

export interface MetadataInput {
	videoId: string
	song: string
	artist: string
	album: string | null
}

const SINGLE_LINE = /^[^\p{Cc}\u2028\u2029]+$/u

function field(raw: unknown, maxLength: number): string | null {
	if (typeof raw !== "string") return null
	const value = raw.trim()
	return value.length > 0 && value.length <= maxLength && SINGLE_LINE.test(value) ? value : null
}

export function parseMetadataProposal(body: Record<string, unknown>): MetadataInput | null {
	const { videoId, album } = body
	if (typeof videoId !== "string" || !isVideoId(videoId)) return null
	const song = field(body.song, config.validation.song.maxLength)
	const artist = field(body.artist, config.validation.artist.maxLength)
	if (song === null || artist === null) return null
	if (album !== undefined && album !== null && typeof album !== "string") return null
	const trimmedAlbum = typeof album === "string" ? album.trim() : ""
	if (trimmedAlbum !== "" && !isValidAlbum(trimmedAlbum)) return null
	return { videoId, song, artist, album: trimmedAlbum === "" ? null : trimmedAlbum }
}
