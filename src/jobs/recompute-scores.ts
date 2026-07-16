import { closeRedis } from "@/infra/cache"
import { closePool } from "@/infra/database"
import { createEnv } from "@/infra/env"
import { Logger } from "@/infra/logger"
import { recomputeAllScores } from "@/jobs/score-updater"

const log = new Logger("recompute")

async function main() {
	const env = createEnv()
	const { updated } = await recomputeAllScores(env)
	log.info("recompute finished", { updated })
	await closePool()
	await closeRedis()
}

main().catch((err) => {
	log.error("recompute failed", { error: (err as Error).message })
	process.exit(1)
})
