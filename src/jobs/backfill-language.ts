import { Logger } from "@/infra/logger"
import type { Env, LyricsFormat } from "@/types"
import { decompress, isCompressed } from "@/utils/compression"
import { DETECTOR_VERSION, detectLanguageBatch } from "@/utils/detect-language"
import { extractPlainText } from "@/utils/extract-text"

const log = new Logger("backfill-language")
const BATCH_SIZE = 50

interface Row {
	id: number
	lyrics: string
	format: LyricsFormat
}

export async function backfillLanguage(env: Env): Promise<{ scanned: number; updated: number }> {
	if (!process.env.DETECTION_URL) {
		log.warn("DETECTION_URL unset, skipping backfill")
		return { scanned: 0, updated: 0 }
	}

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
			.all<Row>()

		const rows = batch.results || []
		if (rows.length === 0) break

		const texts: string[] = []
		for (const row of rows) {
			try {
				const content = isCompressed(row.lyrics) ? await decompress(row.lyrics) : row.lyrics
				texts.push(extractPlainText(content, row.format))
			} catch (err) {
				log.warn("decompress/extract failed", { id: row.id, error: (err as Error).message })
				texts.push("")
			}
		}

		const results = await detectLanguageBatch(texts)

		for (let i = 0; i < rows.length; i++) {
			scanned++
			const row = rows[i]
			const result = results[i]
			const stampVersion = result.ready ? DETECTOR_VERSION : null
			try {
				await env.DB.prepare(
					`UPDATE lyrics
					 SET language = ?,
					     language_detector_version = ?,
					     language_source = 'detector',
					     language_detection_attempted_at = NOW()
					 WHERE id = ?`
				)
					.bind(result.language, stampVersion, row.id)
					.run()
				if (result.language) updated++
			} catch (err) {
				log.warn("update failed", { id: row.id, error: (err as Error).message })
			}
		}

		log.info("backfill batch complete", { batch: rows.length, scanned, updated })

		await new Promise((resolve) => setImmediate(resolve))
	}

	return { scanned, updated }
}
