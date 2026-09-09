import { Logger } from "@/infra/logger"
import type { Env, LyricsFormat } from "@/types"
import { decompress, isCompressed } from "@/utils/compression"
import { hasTranslationMarkers } from "@/utils/translation-markers"

const log = new Logger("backfill")
const BATCH_SIZE = 100

export async function backfillTranslationMarkers(
	env: Env
): Promise<{ scanned: number; flagged: number }> {
	let scanned = 0
	let flagged = 0

	while (true) {
		const batch = await env.DB.prepare(
			`SELECT id, lyrics, format FROM lyrics
			 WHERE has_translation IS NULL
			 LIMIT ?`
		)
			.bind(BATCH_SIZE)
			.all<{ id: number; lyrics: string; format: LyricsFormat }>()

		const rows = batch.results || []
		if (rows.length === 0) break

		for (const row of rows) {
			let flag = false
			if (row.format === "ttml") {
				try {
					const content = isCompressed(row.lyrics) ? await decompress(row.lyrics) : row.lyrics
					flag = hasTranslationMarkers(content)
				} catch (err) {
					log.warn("failed to scan row for translation markers", {
						id: row.id,
						error: (err as Error).message,
					})
				}
			}

			await env.DB.prepare(
				"UPDATE lyrics SET has_translation = ? WHERE id = ? AND has_translation IS NULL"
			)
				.bind(flag, row.id)
				.run()

			scanned++
			if (flag) flagged++
		}

		log.info("translation marker backfill batch", { batch: rows.length, scanned, flagged })
	}

	return { scanned, flagged }
}
