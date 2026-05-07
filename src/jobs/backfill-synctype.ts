import { Logger } from "@/infra/logger"
import type { Env, LyricsFormat } from "@/types"
import { decompress, isCompressed } from "@/utils/compression"
import { detectSyncType } from "@/utils/validation"

const log = new Logger("backfill")
const BATCH_SIZE = 100

type Row = {
	id: number
	video_id: string
	format: LyricsFormat
	lyrics: string
	sync_type: "richsync" | "linesync" | "plain"
}

type SyncType = "richsync" | "linesync" | "plain"

export async function backfillSyncType(env: Env): Promise<{ scanned: number; changed: number }> {
	let scanned = 0
	let changed = 0
	let cursor = 0
	const byTransition = new Map<string, number>()
	const changedVideoIds = new Set<string>()

	while (true) {
		const batch = await env.DB.prepare(
			`SELECT id, video_id, format, lyrics, sync_type FROM lyrics
			 WHERE id > ? AND deleted_at IS NULL
			 ORDER BY id ASC
			 LIMIT ?`
		)
			.bind(cursor, BATCH_SIZE)
			.all<Row>()

		const rows = batch.results || []
		if (rows.length === 0) break

		for (const row of rows) {
			scanned++
			cursor = row.id
			try {
				const content = isCompressed(row.lyrics) ? await decompress(row.lyrics) : row.lyrics
				const detected = detectSyncType(content, row.format)

				if (detected === row.sync_type) continue

				await env.DB.prepare(
					`UPDATE lyrics SET sync_type = ?, updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
					 WHERE id = ? AND sync_type = ?`
				)
					.bind(detected, row.id, row.sync_type)
					.run()

				const key = `${row.sync_type}→${detected}`
				byTransition.set(key, (byTransition.get(key) ?? 0) + 1)
				changedVideoIds.add(row.video_id)
				changed++

				await env.CACHE.delete(`v:${row.video_id}`)
			} catch (err) {
				log.warn("failed to backfill sync_type for row", {
					id: row.id,
					error: (err as Error).message,
				})
			}
		}

		log.info("sync_type backfill batch complete", {
			batch: rows.length,
			scanned,
			changed,
		})
	}

	if (changed > 0) {
		const feedKeys = await env.CACHE.keys("feed:global:*")
		for (const key of feedKeys) {
			await env.CACHE.delete(key)
		}
		log.info("sync_type backfill complete", {
			scanned,
			changed,
			byTransition: Object.fromEntries(byTransition),
			feedKeysCleared: feedKeys.length,
		})
	} else {
		log.info("sync_type backfill complete", { scanned, changed })
	}

	return { scanned, changed }
}

export type { SyncType }
