import { softDeleteLyrics } from "@/db/lyrics"
import { closeRedis } from "@/infra/cache"
import { closePool } from "@/infra/database"
import { createEnv } from "@/infra/env"
import type { Env } from "@/types"

async function main() {
	const [, , idArg, ...reasonParts] = process.argv
	const lyricsId = Number(idArg)
	const reason = reasonParts.join(" ").trim()

	if (!Number.isInteger(lyricsId) || !reason) {
		console.error("usage: pnpm run admin:delete <lyricsId> <reason>")
		process.exit(1)
	}

	const env = createEnv()

	try {
		const adminUserId = await ensureAdminUser(env)
		const result = await softDeleteLyrics(env, lyricsId, adminUserId, "admin", reason)

		if (!result.deleted) {
			console.error(`lyrics ${lyricsId} not deleted: ${result.reason}`)
			process.exitCode = 1
			return
		}

		console.log(`deleted lyrics ${lyricsId}, caches evicted`)
	} finally {
		await closePool()
		await closeRedis()
	}
}

async function ensureAdminUser(env: Env): Promise<number> {
	const adminKeyId = "__admin__"
	const existing = await env.DB.prepare("SELECT id FROM users WHERE key_id = ?")
		.bind(adminKeyId)
		.first<{ id: number }>()
	if (existing) return existing.id
	const inserted = await env.DB.prepare("INSERT INTO users (key_id) VALUES (?) RETURNING id")
		.bind(adminKeyId)
		.first<{ id: number }>()
	if (!inserted) throw new Error("could not create admin user")
	return inserted.id
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
