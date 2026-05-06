import pg from "pg"
import { KVCompat, getRedis, closeRedis } from "@/infra/cache"

async function main() {
	const [, , idArg, ...reasonParts] = process.argv
	const lyricsId = Number(idArg)
	const reason = reasonParts.join(" ").trim()

	if (Number.isNaN(lyricsId) || !reason) {
		console.error("usage: pnpm run admin:delete <lyricsId> <reason>")
		process.exit(1)
	}

	const databaseUrl = process.env.DATABASE_URL
	const redisUrl = process.env.REDIS_URL
	if (!databaseUrl || !redisUrl) {
		console.error("DATABASE_URL and REDIS_URL required")
		process.exit(1)
	}

	const pool = new pg.Pool({ connectionString: databaseUrl })
	const cache = new KVCompat(getRedis(redisUrl))

	try {
		const adminUserId = await ensureAdminUser(pool)

		const row = await pool.query<{ video_id: string; deleted_at: number | null }>(
			"SELECT video_id, deleted_at FROM lyrics WHERE id = $1",
			[lyricsId]
		)

		if (row.rowCount === 0) {
			console.error(`lyrics ${lyricsId} not found`)
			process.exit(1)
		}
		if (row.rows[0].deleted_at !== null) {
			console.error(`lyrics ${lyricsId} is already deleted`)
			process.exit(1)
		}

		await pool.query(
			`UPDATE lyrics SET
				deleted_at = EXTRACT(EPOCH FROM NOW())::INTEGER,
				deleted_by_user_id = $1,
				deleted_by_role = 'admin',
				deletion_reason = $2
			WHERE id = $3 AND deleted_at IS NULL`,
			[adminUserId, reason, lyricsId]
		)

		const videoId = row.rows[0].video_id
		await cache.delete(`v:${videoId}`)
		const feedKeys = await cache.keys("feed:global:*")
		for (const key of feedKeys) await cache.delete(key)

		console.log(`deleted lyrics ${lyricsId} (video ${videoId}); cleared ${feedKeys.length + 1} cache keys`)
	} finally {
		await pool.end()
		await closeRedis()
	}
}

async function ensureAdminUser(pool: pg.Pool): Promise<number> {
	const adminKeyId = "__admin__"
	const existing = await pool.query<{ id: number }>(
		"SELECT id FROM users WHERE key_id = $1",
		[adminKeyId]
	)
	if (existing.rowCount && existing.rowCount > 0) return existing.rows[0].id
	const inserted = await pool.query<{ id: number }>(
		"INSERT INTO users (key_id) VALUES ($1) RETURNING id",
		[adminKeyId]
	)
	return inserted.rows[0].id
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
