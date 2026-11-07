import { createHash } from "node:crypto"
import type { LyricsResponse } from "@/types"

type LyricIdentity = Pick<
	LyricsResponse,
	"id" | "song" | "artist" | "album" | "isrc" | "language" | "format" | "lyrics"
>

/** Weak, because votes, confidence and submitter stats can change under the same tag. */
export function lyricEtag(lyric: LyricIdentity): string {
	const { song, artist, album, isrc, language, format, lyrics } = lyric
	const hash = createHash("sha1")
		.update(JSON.stringify([song, artist, album, isrc, language, format, lyrics]))
		.digest("base64url")
	return `W/"${lyric.id}-${hash}"`
}

const opaque = (tag: string) => tag.trim().replace(/^W\//, "")

export function matchesEtag(ifNoneMatch: string | undefined, etag: string): boolean {
	if (!ifNoneMatch) return false
	return ifNoneMatch.split(",").some((tag) => tag.trim() === "*" || opaque(tag) === opaque(etag))
}
