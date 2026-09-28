import { recordMissingHistory } from "@/db/council-events"
import { advisoryXactLock } from "@/infra/database"
import type { Env } from "@/types"

export async function backfillCouncilEvents(env: Env): Promise<number> {
	return env.DB.transaction(async (tx) => {
		await advisoryXactLock(tx, "backfill-council-events")
		return recordMissingHistory(tx)
	})
}
