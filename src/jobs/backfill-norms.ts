import { Logger } from "@/infra/logger"
import type { Env } from "@/types"
import { normalize, normalizeArtist, normalizeSong } from "@/utils/normalize"

const log = new Logger("backfill-norms")
const BATCH_SIZE = 200

interface Row {
	id: number
	song: string
	artist: string
	album: string | null
	song_norm: string
	artist_norm: string
	album_norm: string | null
}

export async function backfillNorms(env: Env): Promise<{ scanned: number; updated: number }> {
	let scanned = 0
	let updated = 0
	let lastId = 0

	while (true) {
		const batch = await env.DB.prepare(
			`SELECT id, song, artist, album, song_norm, artist_norm, album_norm
			 FROM lyrics
			 WHERE id > ? AND deleted_at IS NULL
			 ORDER BY id ASC
			 LIMIT ?`
		)
			.bind(lastId, BATCH_SIZE)
			.all<Row>()

		const rows = batch.results || []
		if (rows.length === 0) break

		for (const row of rows) {
			scanned++
			lastId = row.id

			const songNorm = normalizeSong(row.song)
			const artistNorm = normalizeArtist(row.artist)
			const albumNorm = row.album ? normalize(row.album) : null

			if (
				songNorm === row.song_norm &&
				artistNorm === row.artist_norm &&
				albumNorm === row.album_norm
			) {
				continue
			}

			try {
				await env.DB.prepare(
					"UPDATE lyrics SET song_norm = ?, artist_norm = ?, album_norm = ? WHERE id = ?"
				)
					.bind(songNorm, artistNorm, albumNorm, row.id)
					.run()
				updated++
			} catch (err) {
				log.warn("update failed", { id: row.id, error: (err as Error).message })
			}
		}

		log.info("backfill batch complete", { batch: rows.length, scanned, updated })

		await new Promise((resolve) => setImmediate(resolve))
	}

	return { scanned, updated }
}
