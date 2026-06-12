import { Logger } from "@/infra/logger"
import type { Env, LyricsFormat } from "@/types"
import { decompress, isCompressed } from "@/utils/compression"
import { DETECTOR_VERSION, detectLanguage } from "@/utils/detect-language"

const log = new Logger("backfill")
const BATCH_SIZE = 100

export async function backfillLanguage(env: Env): Promise<{ scanned: number; updated: number }> {
	let scanned = 0
	let updated = 0

	while (true) {
		const batch = await env.DB.prepare(
			`SELECT id, lyrics, format FROM lyrics
			 WHERE COALESCE(language_source, 'detector') <> 'submitter'
			   AND (language_detector_version IS NULL OR language_detector_version < ?)
			   AND deleted_at IS NULL
			 ORDER BY id ASC
			 LIMIT ?`
		)
			.bind(DETECTOR_VERSION, BATCH_SIZE)
			.all<{ id: number; lyrics: string; format: LyricsFormat }>()

		const rows = batch.results || []
		if (rows.length === 0) break

		for (const row of rows) {
			scanned++
			try {
				const content = isCompressed(row.lyrics) ? await decompress(row.lyrics) : row.lyrics
				const detected = detectLanguage(content, row.format)
				await env.DB.prepare(
					`UPDATE lyrics
					 SET language = ?,
					     language_source = 'detector',
					     language_detection_attempted_at = NOW(),
					     language_detector_version = ?
					 WHERE id = ?`
				)
					.bind(detected, DETECTOR_VERSION, row.id)
					.run()
				if (detected) updated++
			} catch (err) {
				log.warn("failed to backfill row", { id: row.id, error: (err as Error).message })
				try {
					await env.DB.prepare(
						`UPDATE lyrics
						 SET language_detection_attempted_at = NOW(),
						     language_detector_version = ?
						 WHERE id = ?`
					)
						.bind(DETECTOR_VERSION, row.id)
						.run()
				} catch (stampErr) {
					log.warn("failed to stamp attempted_at on errored row", {
						id: row.id,
						error: (stampErr as Error).message,
					})
				}
			}
		}

		log.info("language backfill batch complete", { batch: rows.length, scanned, updated })
	}

	return { scanned, updated }
}
