import { config } from "@/config"
import { RANKING_EXPR } from "@/db/lyrics"
import { Logger } from "@/infra/logger"
import type { Env, FeedItem } from "@/types"

const log = new Logger("feed")

const FEED_COLUMNS = `
	id, video_id, song, artist, album, isrc, duration,
	format, language, sync_type, score, effective_score,
	vote_count, confidence, created_at
`

export async function getGlobalFeed(
	env: Env,
	limit: number,
	offset?: number,
	excludeIds?: number[]
): Promise<FeedItem[]> {
	const hasOffset = offset !== undefined && offset > 0
	const hasExclusions = excludeIds && excludeIds.length > 0

	if (!hasOffset && !hasExclusions) {
		const cacheKey = `feed:global:${limit}`
		const cached = await env.CACHE.get(cacheKey)
		if (cached) {
			try {
				return JSON.parse(cached) as FeedItem[]
			} catch {
				await env.CACHE.delete(cacheKey)
			}
		}
	}

	const conditions = ["effective_score > 0"]
	const params: (number | string)[] = []

	if (hasExclusions) {
		const placeholders = excludeIds.map(() => "?").join(", ")
		conditions.push(`id NOT IN (${placeholders})`)
		params.push(...excludeIds)
	}

	params.push(limit)
	if (hasOffset) params.push(offset)

	const sql = `
		SELECT * FROM (
			SELECT DISTINCT ON (video_id) ${FEED_COLUMNS}
			FROM lyrics
			WHERE ${conditions.join(" AND ")}
			ORDER BY video_id, ${RANKING_EXPR} DESC
		) AS unique_videos
		ORDER BY ${RANKING_EXPR} DESC
		LIMIT ?${hasOffset ? " OFFSET ?" : ""}
	`

	const result = await env.DB.prepare(sql)
		.bind(...params)
		.all<FeedItem>()

	if (!hasOffset && !hasExclusions) {
		const cacheKey = `feed:global:${limit}`
		env.CACHE.put(cacheKey, JSON.stringify(result.results), {
			expirationTtl: config.feed.globalCacheTtl,
		}).catch((err) => log.error("failed to cache global feed", { error: String(err) }))
	}

	return result.results
}

export { FEED_COLUMNS }

export async function getMySubmissions(
	env: Env,
	userId: number,
	limit: number,
	cursor?: number
): Promise<FeedItem[]> {
	const conditions = ["submitter_id = ?"]
	const params: (number | string)[] = [userId]

	if (cursor) {
		conditions.push("created_at < ?")
		params.push(cursor)
	}

	params.push(limit)

	const sql = `
		SELECT ${FEED_COLUMNS}
		FROM lyrics
		WHERE ${conditions.join(" AND ")}
		ORDER BY created_at DESC
		LIMIT ?
	`

	const result = await env.DB.prepare(sql)
		.bind(...params)
		.all<FeedItem>()

	return result.results
}

export async function getPersonalizedFeed(
	env: Env,
	userId: number,
	limit: number,
	offset?: number
): Promise<FeedItem[]> {
	// Get user's preferred artists from upvoted lyrics + submissions
	const artistsResult = await env.DB.prepare(
		`
		SELECT DISTINCT artist_norm FROM (
			SELECT l.artist_norm
			FROM votes v
			JOIN lyrics l ON l.id = v.lyrics_id
			WHERE v.user_id = ? AND v.vote = 1

			UNION

			SELECT artist_norm
			FROM lyrics
			WHERE submitter_id = ?
		) AS preferred
		LIMIT ?
		`
	)
		.bind(userId, userId, config.feed.maxArtists)
		.all<{ artist_norm: string }>()

	const artists = artistsResult.results.map((r) => r.artist_norm)

	if (artists.length === 0) {
		log.debug("no history for user, falling back to global", { userId })
		return getGlobalFeed(env, limit, offset)
	}

	// Single-stream query: rank everything globally, then boost preferred-artist
	// items (excluding already-voted) to the top. This keeps offset pagination
	// duplicate-free and gap-free since LIMIT/OFFSET applies to one stable order.
	const artistPlaceholders = artists.map(() => "?").join(", ")
	const hasOffset = offset !== undefined && offset > 0
	const params: (number | string)[] = [...artists, userId, limit]
	if (hasOffset) params.push(offset)

	const sql = `
		SELECT * FROM (
			SELECT DISTINCT ON (video_id) ${FEED_COLUMNS}, artist_norm,
				CASE
					WHEN artist_norm IN (${artistPlaceholders})
						AND id NOT IN (SELECT lyrics_id FROM votes WHERE user_id = ?)
					THEN 1 ELSE 0
				END AS is_personalized
			FROM lyrics
			WHERE effective_score > 0
			ORDER BY video_id, ${RANKING_EXPR} DESC
		) AS unique_videos
		ORDER BY is_personalized DESC, ${RANKING_EXPR} DESC
		LIMIT ?${hasOffset ? " OFFSET ?" : ""}
	`

	const result = await env.DB.prepare(sql)
		.bind(...params)
		.all<FeedItem>()
	return result.results
}
