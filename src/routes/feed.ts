import { Elysia, t } from "elysia"
import { getGlobalFeed, getPersonalizedFeed } from "@/db/feed"
import { getUserVotesForIds } from "@/db/votes"
import { config } from "@/config"
import type { Env, FeedItem } from "@/types"
import { readRateLimit } from "@/utils/read-rate-limit"

export function toFeedResponse(row: FeedItem) {
	return {
		id: row.id,
		videoId: row.video_id,
		song: row.song,
		artist: row.artist,
		album: row.album || undefined,
		isrc: row.isrc || undefined,
		duration: row.duration,
		format: row.format,
		language: row.language || undefined,
		syncType: row.sync_type,
		score: row.score,
		effectiveScore: row.effective_score,
		voteCount: row.vote_count,
		confidence: row.confidence,
		createdAt: row.created_at,
		hidden: row.hidden ?? false,
	}
}

export const feedRoutes = (env: Env) =>
	new Elysia({ prefix: "/feed" })
		.decorate("env", env)
		.use(readRateLimit)
		.derive({ as: "scoped" }, async ({ headers, env }) => {
			const keyId = headers["x-key-id"]
			if (!keyId) return { feedUserId: null as number | null }

			const user = await env.DB.prepare("SELECT id FROM users WHERE key_id = ?")
				.bind(keyId)
				.first<{ id: number }>()

			return { feedUserId: user?.id ?? null }
		})
		.get(
			"/",
			async ({ query, env, feedUserId }) => {
				const limit = Math.min(
					Math.max(1, query.limit ? Number(query.limit) : config.feed.defaultLimit),
					config.feed.maxLimit
				)
				const offset = query.cursor ? Math.max(0, Number(query.cursor)) : 0

				const items = feedUserId
					? await getPersonalizedFeed(env, feedUserId, limit, offset)
					: await getGlobalFeed(env, limit, offset)

				const nextCursor = items.length === limit ? offset + items.length : undefined

				const votesMap = feedUserId
					? await getUserVotesForIds(
							env,
							items.map((i) => i.id),
							feedUserId
						)
					: null

				return {
					success: true,
					data: items.map((item) => ({
						...toFeedResponse(item),
						userVote: votesMap?.get(item.id) ?? null,
					})),
					nextCursor,
				}
			},
			{
				query: t.Object({
					limit: t.Optional(t.String()),
					cursor: t.Optional(t.String()),
				}),
			}
		)
