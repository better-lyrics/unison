import { createHash } from "node:crypto"
import type { LyricsResponse } from "@/types"

type LyricIdentity = Pick<
	LyricsResponse,
	"id" | "videoId" | "song" | "artist" | "album" | "isrc" | "language" | "format" | "lyrics"
> & { variant?: string; matchedBy?: string }

/** Weak, because votes, confidence and submitter stats can change under the same tag. */
export function lyricEtag(lyric: LyricIdentity): string {
	const { videoId, song, artist, album, isrc, language, format, lyrics, variant, matchedBy } = lyric
	const hash = createHash("sha1")
		.update(
			JSON.stringify([
				videoId,
				song,
				artist,
				album,
				isrc,
				language,
				format,
				lyrics,
				variant,
				matchedBy,
			])
		)
		.digest("base64url")
	return `W/"${lyric.id}-${hash}"`
}

const opaque = (tag: string) => tag.trim().replace(/^W\//, "")

export function matchesEtag(ifNoneMatch: string | undefined, etag: string): boolean {
	if (!ifNoneMatch) return false
	return ifNoneMatch.split(",").some((tag) => tag.trim() === "*" || opaque(tag) === opaque(etag))
}
