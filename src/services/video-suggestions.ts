import { config } from "@/config"
import { listVideoLinks } from "@/db/video-links"
import type { Env } from "@/types"
import { type SongCandidate, searchSongs } from "@/utils/innertube"
import { normalize, normalizeArtist, normalizeSong } from "@/utils/normalize"

export type Suggestion = SongCandidate & { matchScore: number; withinDurationDelta: boolean }

export type SuggestResult =
	| { ok: true; suggestions: Suggestion[] }
	| { ok: false; reason: "not_found" | "not_owner" }

type Deps = { search?: (query: string) => Promise<SongCandidate[]> }

type VariantRow = {
	submitter_id: number | null
	song: string
	artist: string
	album: string | null
	duration: number
	deleted_at: number | null
}

async function cachedSearch(
	env: Env,
	song: string,
	artist: string,
	search: (query: string) => Promise<SongCandidate[]>
): Promise<SongCandidate[]> {
	const key = `songsearch:${normalizeSong(song)}|${normalizeArtist(artist)}`
	const cached = await env.CACHE.get(key)
	if (cached) {
		try {
			return JSON.parse(cached) as SongCandidate[]
		} catch {
			// fall through to a fresh search on a corrupt cache entry
		}
	}
	const results = await search(`${song} ${artist}`)
	await env.CACHE.put(key, JSON.stringify(results), {
		expirationTtl: config.videoLinking.suggestionCacheTtlSeconds,
	})
	return results
}

export async function suggestVideosForVariant(
	env: Env,
	lyricsId: number,
	userId: number,
	deps: Deps = {}
): Promise<SuggestResult> {
	const row = await env.DB.prepare(
		"SELECT submitter_id, song, artist, album, duration, deleted_at FROM lyrics WHERE id = ?"
	)
		.bind(lyricsId)
		.first<VariantRow>()

	if (!row || row.deleted_at !== null) return { ok: false, reason: "not_found" }
	if (row.submitter_id !== userId) return { ok: false, reason: "not_owner" }

	const search = deps.search ?? searchSongs
	const candidates = await cachedSearch(env, row.song, row.artist, search)
	const linked = new Set((await listVideoLinks(env, lyricsId)).map((v) => v.videoId))

	const normSong = normalizeSong(row.song)
	const normArtist = normalizeArtist(row.artist)
	const normAlbum = row.album ? normalize(row.album) : null

	const suggestions = candidates
		.filter((c) => !linked.has(c.videoId))
		.map((c) => {
			const titleEq = normalizeSong(c.title) === normSong ? 1 : 0
			const artistEq = normalizeArtist(c.artist) === normArtist ? 1 : 0
			const albumEq =
				normAlbum !== null && c.album !== null && normalize(c.album) === normAlbum ? 1 : 0
			const matchScore = 0.5 * titleEq + 0.3 * artistEq + 0.2 * albumEq
			const withinDurationDelta =
				c.durationSeconds !== null &&
				Math.abs(c.durationSeconds - row.duration) <= config.videoLinking.durationDeltaSeconds
			return { ...c, matchScore, withinDurationDelta }
		})
		.sort(
			(a, b) =>
				b.matchScore - a.matchScore || Number(b.withinDurationDelta) - Number(a.withinDurationDelta)
		)

	return { ok: true, suggestions }
}
