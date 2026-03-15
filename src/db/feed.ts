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
	cursor?: number,
	excludeIds?: number[]
): Promise<FeedItem[]> {
	// Try cache for default request (no cursor, no exclusions)
	if (!cursor && (!excludeIds || excludeIds.length === 0)) {
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

	if (cursor) {
		conditions.push("created_at < ?")
		params.push(cursor)
	}

	if (excludeIds && excludeIds.length > 0) {
		const placeholders = excludeIds.map(() => "?").join(", ")
		conditions.push(`id NOT IN (${placeholders})`)
		params.push(...excludeIds)
	}

	params.push(limit)

	const sql = `
		SELECT * FROM (
			SELECT DISTINCT ON (video_id) ${FEED_COLUMNS}
			FROM lyrics
			WHERE ${conditions.join(" AND ")}
			ORDER BY video_id, ${RANKING_EXPR} DESC
		) AS unique_videos
		ORDER BY ${RANKING_EXPR} DESC
		LIMIT ?
	`

	const result = await env.DB.prepare(sql)
		.bind(...params)
		.all<FeedItem>()

	// Cache default request
	if (!cursor && (!excludeIds || excludeIds.length === 0)) {
		const cacheKey = `feed:global:${limit}`
		env.CACHE.put(cacheKey, JSON.stringify(result.results), {
			expirationTtl: config.feed.globalCacheTtl,
		}).catch((err) => log.error("failed to cache global feed", { error: String(err) }))
	}

	return result.results
}

export async function getPersonalizedFeed(
	env: Env,
	userId: number,
	limit: number,
	cursor?: number
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
		return getGlobalFeed(env, limit, cursor)
	}

	// Fetch quality lyrics from preferred artists, excluding already-voted
	const artistPlaceholders = artists.map(() => "?").join(", ")
	const conditions = [
		`artist_norm IN (${artistPlaceholders})`,
		"effective_score > 0",
		"id NOT IN (SELECT lyrics_id FROM votes WHERE user_id = ?)",
	]
	const params: (number | string)[] = [...artists, userId]

	if (cursor) {
		conditions.push("created_at < ?")
		params.push(cursor)
	}

	params.push(limit)

	const sql = `
		SELECT * FROM (
			SELECT DISTINCT ON (video_id) ${FEED_COLUMNS}
			FROM lyrics
			WHERE ${conditions.join(" AND ")}
			ORDER BY video_id, ${RANKING_EXPR} DESC
		) AS unique_videos
		ORDER BY ${RANKING_EXPR} DESC
		LIMIT ?
	`

	const personalizedResult = await env.DB.prepare(sql)
		.bind(...params)
		.all<FeedItem>()
	const personalized = personalizedResult.results

	// Fill remaining slots with global feed if personalized results < limit
	if (personalized.length < limit) {
		const remaining = limit - personalized.length
		const excludeIds = personalized.map((r) => r.id)
		const global = await getGlobalFeed(env, remaining, cursor, excludeIds)
		return [...personalized, ...global]
	}

	return personalized
}
