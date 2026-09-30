import type { Env } from "@/types"

export interface SongMetadata {
	song: string
	artist: string
	album: string | null
}

export async function approvedMetadata(env: Env, videoId: string): Promise<SongMetadata | null> {
	return env.DB.prepare(
		`SELECT song, artist, album FROM metadata_proposals
			WHERE video_id = ? AND status = 'passed'
			ORDER BY decided_at DESC, id DESC LIMIT 1`
	)
		.bind(videoId)
		.first<SongMetadata>()
}
