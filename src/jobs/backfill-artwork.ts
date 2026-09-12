import { config } from "@/config"
import { getVideoArtwork, insertVideoArtworkIfAbsent } from "@/db/artwork"
import { Logger } from "@/infra/logger"
import type { Env } from "@/types"
import { isAlbumArtUrl, normalizeArtworkUrl } from "@/utils/artwork"

const log = new Logger("backfill-artwork")
const BATCH_SIZE = 500

export async function backfillArtwork(env: Env): Promise<{ seeded: number }> {
	let seeded = 0
	let offset = 0
	while (true) {
		const { results } = await env.DB.prepare(
			`SELECT video_id, thumbnail_url FROM requested_songs
			 WHERE thumbnail_url IS NOT NULL
			 ORDER BY video_id LIMIT ? OFFSET ?`
		)
			.bind(BATCH_SIZE, offset)
			.all<{ video_id: string; thumbnail_url: string }>()

		if (results.length === 0) break
		offset += results.length

		for (const row of results) {
			if (!isAlbumArtUrl(row.thumbnail_url)) continue
			if (await getVideoArtwork(env, row.video_id)) continue
			await insertVideoArtworkIfAbsent(
				env,
				row.video_id,
				normalizeArtworkUrl(row.thumbnail_url, config.artwork.size)
			)
			seeded++
		}
	}
	log.info("artwork backfill complete", { seeded })
	return { seeded }
}
