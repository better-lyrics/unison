import type { Env } from "@/types"

export interface StoredArtwork {
	artworkUrl: string | null
	fallbackUrl: string | null
	uncopyable: boolean
	checkedAt: number
}

export async function getVideoArtwork(env: Env, videoId: string): Promise<StoredArtwork | null> {
	const row = await env.DB.prepare(
		"SELECT artwork_url, fallback_url, fallback_bytes, checked_at FROM song_artwork WHERE video_id = ?"
	)
		.bind(videoId)
		.first<{
			artwork_url: string | null
			fallback_url: string | null
			fallback_bytes: number | null
			checked_at: number
		}>()
	if (!row) return null
	return {
		artworkUrl: row.artwork_url,
		fallbackUrl: row.fallback_url,
		uncopyable: row.fallback_bytes === UNCOPYABLE_BYTES,
		checkedAt: Number(row.checked_at),
	}
}

/** A new cover drops the fallback, which is a copy of the old one. */
export async function upsertVideoArtwork(
	env: Env,
	videoId: string,
	artworkUrl: string | null
): Promise<void> {
	await env.DB.prepare(
		`INSERT INTO song_artwork (video_id, artwork_url, checked_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT (video_id) DO UPDATE SET
		   artwork_url = EXCLUDED.artwork_url,
		   checked_at = EXCLUDED.checked_at,
		   fallback_url = CASE WHEN song_artwork.artwork_url IS NOT DISTINCT FROM EXCLUDED.artwork_url
		     THEN song_artwork.fallback_url END,
		   fallback_bytes = CASE WHEN song_artwork.artwork_url IS NOT DISTINCT FROM EXCLUDED.artwork_url
		     THEN song_artwork.fallback_bytes END`
	)
		.bind(videoId, artworkUrl, Math.floor(Date.now() / 1000))
		.run()
}

/** Only lands while the cover is still the one that was copied. */
export async function setArtworkFallback(
	env: Env,
	videoId: string,
	artworkUrl: string,
	fallbackUrl: string,
	bytes: number
): Promise<boolean> {
	const row = await env.DB.prepare(
		`UPDATE song_artwork SET fallback_url = ?, fallback_bytes = ?, served_at = ?
		 WHERE video_id = ? AND artwork_url = ?
		 RETURNING video_id`
	)
		.bind(fallbackUrl, bytes, Math.floor(Date.now() / 1000), videoId, artworkUrl)
		.first<{ video_id: string }>()
	return row !== null
}

export async function touchArtwork(env: Env, videoId: string): Promise<void> {
	await env.DB.prepare("UPDATE song_artwork SET served_at = ? WHERE video_id = ?")
		.bind(Math.floor(Date.now() / 1000), videoId)
		.run()
}

export async function artworkWithoutFallback(
	env: Env,
	afterVideoId: string,
	limit: number
): Promise<{ videoId: string; artworkUrl: string }[]> {
	const { results } = await env.DB.prepare(
		`SELECT video_id, artwork_url FROM song_artwork
		 WHERE fallback_url IS NULL AND fallback_bytes IS NULL
		   AND artwork_url LIKE 'https://%.googleusercontent.com/%'
		   AND video_id > ?
		 ORDER BY video_id
		 LIMIT ?`
	)
		.bind(afterVideoId, limit)
		.all<{ video_id: string; artwork_url: string }>()
	return results.map((r) => ({ videoId: r.video_id, artworkUrl: r.artwork_url }))
}

export async function fallbackBytesTotal(env: Env): Promise<number> {
	const row = await env.DB.prepare(
		"SELECT COALESCE(SUM(fallback_bytes), 0) AS total FROM song_artwork WHERE fallback_url IS NOT NULL"
	).first<{ total: number | string }>()
	return Number(row?.total ?? 0)
}

export async function leastServedFallbacks(
	env: Env,
	limit: number
): Promise<{ videoId: string; fallbackUrl: string; bytes: number }[]> {
	const { results } = await env.DB.prepare(
		`SELECT video_id, fallback_url, fallback_bytes FROM song_artwork
		 WHERE fallback_url IS NOT NULL
		 ORDER BY served_at NULLS FIRST, video_id
		 LIMIT ?`
	)
		.bind(limit)
		.all<{ video_id: string; fallback_url: string; fallback_bytes: number | null }>()
	return results.map((r) => ({
		videoId: r.video_id,
		fallbackUrl: r.fallback_url,
		bytes: Number(r.fallback_bytes ?? 0),
	}))
}

export const EVICTED_BYTES = 0
export const UNCOPYABLE_BYTES = -1

/** Evicted copies come back when served again; uncopyable ones wait until the cover changes. */
export async function clearArtworkFallback(
	env: Env,
	videoId: string,
	fallbackUrl: string
): Promise<void> {
	await env.DB.prepare(
		"UPDATE song_artwork SET fallback_url = NULL, fallback_bytes = ? WHERE video_id = ? AND fallback_url = ?"
	)
		.bind(EVICTED_BYTES, videoId, fallbackUrl)
		.run()
}

export async function isArtworkUncopyable(
	env: Env,
	videoId: string,
	artworkUrl: string
): Promise<boolean> {
	const row = await env.DB.prepare(
		"SELECT 1 AS hit FROM song_artwork WHERE video_id = ? AND artwork_url = ? AND fallback_bytes = ?"
	)
		.bind(videoId, artworkUrl, UNCOPYABLE_BYTES)
		.first<{ hit: number }>()
	return row !== null
}

export async function markArtworkUncopyable(
	env: Env,
	videoId: string,
	artworkUrl: string
): Promise<boolean> {
	const row = await env.DB.prepare(
		`UPDATE song_artwork SET fallback_bytes = ?
		 WHERE video_id = ? AND artwork_url = ? AND fallback_url IS NULL
		 RETURNING video_id`
	)
		.bind(UNCOPYABLE_BYTES, videoId, artworkUrl)
		.first<{ video_id: string }>()
	return row !== null
}

export async function insertVideoArtworkIfAbsent(
	env: Env,
	videoId: string,
	artworkUrl: string | null
): Promise<void> {
	await env.DB.prepare(
		`INSERT INTO song_artwork (video_id, artwork_url, checked_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT (video_id) DO NOTHING`
	)
		.bind(videoId, artworkUrl, Math.floor(Date.now() / 1000))
		.run()
}

export interface VideoSong {
	song: string
	artist: string
	isrc: string | null
}

export async function findSongForVideo(env: Env, videoId: string): Promise<VideoSong | null> {
	return env.DB.prepare(
		`SELECT song, artist, isrc FROM (
		   SELECT l.song, l.artist, l.isrc, 0 AS source, (l.video_id = ?) AS is_primary, l.id
		   FROM lyrics l
		   WHERE l.deleted_at IS NULL
		     AND (l.video_id = ? OR l.id IN (SELECT lyrics_id FROM lyrics_video_ids WHERE video_id = ?))
		   UNION ALL
		   SELECT song, artist, NULL AS isrc, 1 AS source, FALSE AS is_primary, 0 AS id
		   FROM requested_songs WHERE video_id = ?
		 ) known
		 ORDER BY source, is_primary DESC, (isrc IS NOT NULL) DESC, id
		 LIMIT 1`
	)
		.bind(videoId, videoId, videoId, videoId)
		.first<VideoSong>()
}
