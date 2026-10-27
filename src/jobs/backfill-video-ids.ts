import { evictFeedCaches } from "@/db/feed"
import { invalidateCacheForLyric, softDeleteLyrics } from "@/db/lyrics"
import { Logger } from "@/infra/logger"
import type { Env } from "@/types"
import { videoIdFromInput } from "@/utils/video-id"

const log = new Logger("backfill-video-ids")
const VIDEO_ID_PATTERN = "^[A-Za-z0-9_-]{11}$"

interface Row {
	id: number
	video_id: string
	submitter_id: number | null
}

export async function backfillVideoIds(env: Env): Promise<{ repaired: number; deleted: number }> {
	const { results } = await env.DB.prepare(
		`SELECT id, video_id, submitter_id FROM lyrics
		 WHERE deleted_at IS NULL AND video_id !~ '${VIDEO_ID_PATTERN}'
		 ORDER BY id`
	).all<Row>()

	let repaired = 0
	let deleted = 0
	for (const row of results) {
		const videoId = videoIdFromInput(row.video_id)
		try {
			if (videoId) {
				await env.DB.transaction(async (tx) => {
					await tx
						.prepare("UPDATE lyrics SET video_id = ? WHERE id = ?")
						.bind(videoId, row.id)
						.run()
					await tx
						.prepare(
							`DELETE FROM lyrics_video_ids WHERE lyrics_id = ? AND video_id !~ '${VIDEO_ID_PATTERN}'`
						)
						.bind(row.id)
						.run()
					await tx
						.prepare(
							"INSERT INTO lyrics_video_ids (lyrics_id, video_id) VALUES (?, ?) ON CONFLICT DO NOTHING"
						)
						.bind(row.id, videoId)
						.run()
				})
				await invalidateCacheForLyric(env, row.id)
				repaired++
			} else if (row.submitter_id === null) {
				log.warn("unrecoverable video id on a lyric with no submitter", { id: row.id })
			} else {
				const result = await softDeleteLyrics(
					env,
					row.id,
					row.submitter_id,
					"system",
					"invalid video id"
				)
				if (result.deleted) {
					deleted++
					log.info("deleted lyric with unrecoverable video id", {
						id: row.id,
						videoId: row.video_id,
					})
				}
			}
		} catch (err) {
			log.warn("video id backfill failed", { id: row.id, error: (err as Error).message })
		}
	}

	if (repaired > 0) await evictFeedCaches(env)
	return { repaired, deleted }
}
