import { ensureBaseRevision } from "@/db/lyric-revisions"
import { Logger } from "@/infra/logger"
import type { Env } from "@/types"

const log = new Logger("backfill")
const BATCH_SIZE = 200

export async function backfillRevisions(env: Env): Promise<{ created: number; failed: number }> {
	let created = 0
	let failed = 0
	let cursor = 0

	while (true) {
		const batch = await env.DB.prepare(
			`SELECT id FROM lyrics
			 WHERE id > ? AND current_revision_id IS NULL
			 ORDER BY id ASC
			 LIMIT ?`
		)
			.bind(cursor, BATCH_SIZE)
			.all<{ id: number }>()

		if (batch.results.length === 0) break

		for (const { id } of batch.results) {
			cursor = id
			try {
				await ensureBaseRevision(env.DB, id)
				created++
			} catch (err) {
				failed++
				log.warn("failed to create the base revision for row", {
					id,
					error: (err as Error).message,
				})
			}
		}

		await new Promise((resolve) => setImmediate(resolve))
	}

	return { created, failed }
}
