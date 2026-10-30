import { config } from "@/config"
import { type SuspectKey, findSuspectKeys } from "@/db/vote-strikes"
import { closeRedis } from "@/infra/cache"
import { closePool } from "@/infra/database"
import { createEnv } from "@/infra/env"
import { runVoteIntegrity } from "@/jobs/vote-integrity"
import type { Env } from "@/types"

const USAGE = `usage:
  pnpm vote-integrity            dry run, prints the keys that would be discounted
  pnpm vote-integrity --apply    discounts them and records strikes`

const day = (epoch: number) => new Date(epoch * 1000).toISOString().slice(0, 10)

async function printPlan(env: Env, suspects: SuspectKey[]): Promise<void> {
	const bySubmitter = new Map<number, SuspectKey[]>()
	for (const s of suspects)
		bySubmitter.set(s.submitterId, [...(bySubmitter.get(s.submitterId) ?? []), s])
	const names = await env.DB.prepare(
		"SELECT id, COALESCE(nickname, LEFT(key_id, 12)) AS name FROM users WHERE id = ANY(?::int[])"
	)
		.bind([...bySubmitter.keys()])
		.all<{ id: number; name: string }>()
	const nameOf = new Map(names.results.map((r) => [r.id, r.name]))
	const launch = day(config.voteIntegrity.launchedAt)
	const rows = [...bySubmitter].sort((a, b) => b[1].length - a[1].length)
	for (const [submitterId, keys] of rows) {
		const votes = keys.reduce((sum, k) => sum + k.votes, 0)
		const ring = keys.filter((k) => k.ring).length
		const serial = keys.filter((k) => k.serial).length
		const last = day(Math.max(...keys.map((k) => k.lastVoteAt)))
		console.log(
			`${nameOf.get(submitterId) ?? submitterId} (${submitterId}): ${keys.length} keys, ${votes} votes, ring ${ring}, serial ${serial}, last vote ${last}`
		)
	}
	console.log(
		`\n${suspects.length} keys across ${bySubmitter.size} submitters; launch ${launch} (no rows written)`
	)
}

async function main() {
	const [, , mode] = process.argv
	if (mode !== undefined && mode !== "--apply") {
		console.error(USAGE)
		process.exitCode = 1
		return
	}
	const env = createEnv()
	try {
		if (mode === "--apply") {
			const result = await runVoteIntegrity(env)
			console.log(`recorded ${result.strikes} strikes over ${result.keys} keys`)
		} else {
			await printPlan(env, await findSuspectKeys(env))
		}
	} finally {
		await closePool()
		await closeRedis()
	}
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
