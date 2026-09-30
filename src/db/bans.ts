import { evictFeedCaches } from "@/db/feed"
import { invalidateCuratorLeaderboardCache } from "@/db/leaderboard"
import { invalidateCacheForSubmitter } from "@/db/lyrics"
import type { Env } from "@/types"

export async function setBanned(env: Env, keyId: string, banned: boolean): Promise<boolean> {
	const row = await env.DB.prepare(
		`UPDATE users SET banned_at = CASE WHEN ? THEN COALESCE(banned_at, EXTRACT(EPOCH FROM NOW())::INTEGER) END
		 WHERE key_id = ? RETURNING id`
	)
		.bind(banned, keyId)
		.first<{ id: number }>()
	if (!row) return false

	await invalidateCacheForSubmitter(env, keyId)
	await evictFeedCaches(env)
	await invalidateCuratorLeaderboardCache(env)
	return true
}
