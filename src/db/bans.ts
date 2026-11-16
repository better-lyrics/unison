import { evictFeedCaches } from "@/db/feed"
import { invalidateCuratorLeaderboardCache } from "@/db/leaderboard"
import { lockRevisionAuthor, withdrawPendingSuggestionsBy } from "@/db/lyric-revisions"
import { invalidateCacheForAccount } from "@/db/lyrics"
import type { D1Compat } from "@/infra/database"
import { recalculateScore } from "@/jobs/score-updater"
import type { Env } from "@/types"

export async function setBanned(env: Env, keyId: string, banned: boolean): Promise<boolean> {
	const row = await env.DB.transaction(async (tx) => {
		const user = await tx
			.prepare("SELECT id FROM users WHERE key_id = ?")
			.bind(keyId)
			.first<{ id: number }>()
		if (!user) return null
		if (banned) await lockRevisionAuthor(tx, user.id)
		await tx
			.prepare(
				`UPDATE users SET banned_at = CASE WHEN ? THEN COALESCE(banned_at, EXTRACT(EPOCH FROM NOW())::INTEGER) END
				 WHERE key_id = ?`
			)
			.bind(banned, keyId)
			.run()
		if (banned) await withdrawPendingSuggestionsBy(tx, user.id)
		return user
	})
	if (!row) return false

	const voted = await env.DB.prepare("SELECT lyrics_id FROM votes WHERE user_id = ?")
		.bind(row.id)
		.all<{ lyrics_id: number }>()
	for (const { lyrics_id } of voted.results) await recalculateScore(env, lyrics_id)

	await invalidateCacheForAccount(env, keyId)
	await evictFeedCaches(env)
	await invalidateCuratorLeaderboardCache(env)
	return true
}

export async function isBanned(db: D1Compat, userId: number): Promise<boolean> {
	const row = await db
		.prepare("SELECT 1 AS banned FROM users WHERE id = ? AND banned_at IS NOT NULL")
		.bind(userId)
		.first<{ banned: number }>()
	return row !== null
}
