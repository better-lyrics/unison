import { config } from "@/config"
import { type BookmarkView, listActiveBookmarks, toBookmarkView } from "@/db/council-bookmarks"
import { type CouncilPerson, withTier } from "@/db/council-person"
import { getCuratorTierMap } from "@/db/leaderboard"
import { getSealCandidates } from "@/db/rejections"
import { ttmlFlagsFor } from "@/db/ttml-flags"
import { resolvePeople } from "@/db/users"
import type { Confidence, Env, LyricsFormat, SyncType } from "@/types"
import { labelSignals } from "@/utils/ttml-signals"

export interface QueueSubmitter extends CouncilPerson {
	reputation: number
	submissions: number
	sealed: number
}

export interface QueueItem {
	id: number
	videoId: string
	song: string
	artist: string
	format: LyricsFormat
	syncType: SyncType
	language: string | null
	confidence: Confidence
	score: number
	upvotes: number
	downvotes: number
	voteCount: number
	createdAt: number
	variants: number
	requestsFilled: number
	flags: { code: string; label: string }[]
	submitter: QueueSubmitter | null
	bookmark: BookmarkView | null
}

async function countByKey(env: Env, sql: string, keys: unknown[]): Promise<Map<string, number>> {
	if (keys.length === 0) return new Map()
	const rows = await env.DB.prepare(sql)
		.bind(keys)
		.all<{ k: string | number; n: number | string }>()
	return new Map(rows.results.map((r) => [String(r.k), Number(r.n)]))
}

export async function listCouncilQueue(env: Env): Promise<QueueItem[]> {
	const candidates = await getSealCandidates(env, {
		limit: config.council.queueLimit,
		sort: "top-rated",
	})
	if (candidates.length === 0) return []

	const videoIds = [...new Set(candidates.map((c) => c.video_id))]
	const lyricIds = candidates.map((c) => c.id)
	const submitterIds = [
		...new Set(
			candidates.flatMap((c) => (c.submitter_id === null ? [] : [Number(c.submitter_id)]))
		),
	]

	const [people, tiers, bookmarks, variants, fulfilled, stats, flags] = await Promise.all([
		resolvePeople(env, submitterIds),
		getCuratorTierMap(env),
		listActiveBookmarks(env, { itemType: "seal", itemIds: lyricIds }),
		countByKey(
			env,
			"SELECT video_id AS k, COUNT(*) AS n FROM lyrics WHERE deleted_at IS NULL AND video_id = ANY(?) GROUP BY video_id",
			videoIds
		),
		countByKey(
			env,
			"SELECT lyrics_id AS k, SUM(request_count_snapshot) AS n FROM request_fulfillments WHERE lyrics_id = ANY(?) GROUP BY lyrics_id",
			lyricIds
		),
		submitterIds.length === 0
			? Promise.resolve({ results: [] })
			: env.DB.prepare(
					`SELECT u.id, u.reputation,
						(SELECT COUNT(*) FROM lyrics l WHERE l.submitter_id = u.id AND l.deleted_at IS NULL) AS submissions,
						(SELECT COUNT(*) FROM lyrics l WHERE l.submitter_id = u.id AND l.deleted_at IS NULL
							AND l.committee_approved_at IS NOT NULL) AS sealed
					 FROM users u WHERE u.id = ANY(?)`
				)
					.bind(submitterIds)
					.all<{
						id: number | string
						reputation: number | string
						submissions: number | string
						sealed: number | string
					}>(),
		Promise.all(
			candidates.map((c) =>
				c.format === "ttml"
					? ttmlFlagsFor(env, c.id, c.current_revision_id)
					: Promise.resolve([] as string[])
			)
		),
	])

	const statsById = new Map(stats.results.map((r) => [Number(r.id), r]))
	const bookmarkByItem = new Map(bookmarks.map((b) => [b.itemId, b]))

	return candidates.map((c, i) => {
		const person = c.submitter_id === null ? undefined : people.get(Number(c.submitter_id))
		const stat = person ? statsById.get(person.userId) : undefined
		const bookmark = bookmarkByItem.get(c.id)
		return {
			id: c.id,
			videoId: c.video_id,
			song: c.song,
			artist: c.artist,
			format: c.format,
			syncType: c.sync_type,
			language: c.language,
			confidence: c.confidence,
			score: Number(c.effective_score),
			upvotes: Number(c.upvotes),
			downvotes: Number(c.downvotes),
			voteCount: Number(c.vote_count),
			createdAt: Number(c.created_at),
			variants: variants.get(c.video_id) ?? 1,
			requestsFilled: fulfilled.get(String(c.id)) ?? 0,
			flags: labelSignals(flags[i]),
			submitter: person
				? {
						...withTier(person, tiers),
						reputation: Number(stat?.reputation ?? 0),
						submissions: Number(stat?.submissions ?? 0),
						sealed: Number(stat?.sealed ?? 0),
					}
				: null,
			bookmark: bookmark ? toBookmarkView(bookmark, tiers) : null,
		}
	})
}
