import { servableSyncedVariantServes } from "@/db/predicates"
import { Logger } from "@/infra/logger"
import type { Env } from "@/types"

const log = new Logger("cleanup")
const BATCH_SIZE = 500

export async function cleanupFulfilledRequests(env: Env): Promise<{ deleted: number }> {
	let deleted = 0

	while (true) {
		const batch = await env.DB.prepare(
			`DELETE FROM lyrics_requests
			 WHERE id IN (
			   SELECT lr.id FROM lyrics_requests lr
			   WHERE ${servableSyncedVariantServes("lr.video_id")}
			   LIMIT ?
			 )
			 RETURNING id`
		)
			.bind(BATCH_SIZE)
			.all<{ id: number }>()

		const count = batch.results?.length ?? 0
		if (count === 0) break
		deleted += count
		log.info("cleanup batch complete", { batch: count, total: deleted })
	}

	return { deleted }
}
