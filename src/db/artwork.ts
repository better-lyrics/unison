import type { Env } from "@/types"

export async function getVideoArtwork(
	env: Env,
	videoId: string
): Promise<{ artworkUrl: string | null; checkedAt: number } | null> {
	const row = await env.DB.prepare(
		"SELECT artwork_url, checked_at FROM song_artwork WHERE video_id = ?"
	)
		.bind(videoId)
		.first<{ artwork_url: string | null; checked_at: number }>()
	if (!row) return null
	return { artworkUrl: row.artwork_url, checkedAt: Number(row.checked_at) }
}

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
		   checked_at = EXCLUDED.checked_at`
	)
		.bind(videoId, artworkUrl, Math.floor(Date.now() / 1000))
		.run()
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
