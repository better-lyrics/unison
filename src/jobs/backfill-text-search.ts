import { Logger } from "@/infra/logger"
import type { Env, LyricsFormat } from "@/types"
import { decompress, isCompressed } from "@/utils/compression"
import { extractPlainText } from "@/utils/extract-text"

const log = new Logger("backfill")
const BATCH_SIZE = 100

export async function backfillTextSearch(env: Env): Promise<{ updated: number }> {
	let updated = 0

	while (true) {
		const batch = await env.DB.prepare(
			`SELECT id, lyrics, format FROM lyrics
			 WHERE lyrics_text_search IS NULL
			 LIMIT ?`
		)
			.bind(BATCH_SIZE)
			.all<{ id: number; lyrics: string; format: LyricsFormat }>()

		const rows = batch.results || []
		if (rows.length === 0) break

		for (const row of rows) {
			try {
				const content = isCompressed(row.lyrics) ? await decompress(row.lyrics) : row.lyrics
				const plainText = extractPlainText(content, row.format)

				await env.DB.prepare(
					`UPDATE lyrics SET lyrics_text_search = to_tsvector('simple', ?) WHERE id = ? AND lyrics_text_search IS NULL`
				)
					.bind(plainText, row.id)
					.run()

				updated++
			} catch (err) {
				log.warn("failed to backfill row", {
					id: row.id,
					error: (err as Error).message,
				})
			}
		}

		log.info("backfill batch complete", { batch: rows.length, total: updated })
	}

	return { updated }
}
