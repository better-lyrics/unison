import { Logger } from "@/infra/logger"
import type { Env, LyricsFormat } from "@/types"
import { decompress, isCompressed } from "@/utils/compression"
import { DETECTOR_VERSION, detectLanguage, isEldReady } from "@/utils/detect-language"

const log = new Logger("backfill")
const BATCH_SIZE = 100
// Sanity ceiling: stop the loop if the same row keeps failing to stamp
// (decompress error AND fallback stamp UPDATE error in the same iteration).
// One million rows is well past anything realistic for this corpus and
// guarantees we exit even in pathological failure modes.
const MAX_SCANNED = 1_000_000

export async function backfillLanguage(env: Env): Promise<{ scanned: number; updated: number }> {
	let scanned = 0
	let updated = 0

	while (scanned < MAX_SCANNED) {
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
			const stampVersion = isEldReady() ? DETECTOR_VERSION : null
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
					.bind(detected, stampVersion, row.id)
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
						.bind(stampVersion, row.id)
						.run()
				} catch (stampErr) {
					log.warn("failed to stamp attempted_at on errored row", {
						id: row.id,
						error: (stampErr as Error).message,
					})
				}
			}
		}

		log.info("language backfill batch complete", {
			batch: rows.length,
			scanned,
			updated,
			eldReady: isEldReady(),
		})
	}

	if (scanned >= MAX_SCANNED) {
		log.warn("language backfill hit scan ceiling", { scanned, updated })
	}

	return { scanned, updated }
}
