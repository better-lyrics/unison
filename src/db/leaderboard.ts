import { config } from "@/config"
import { AUTO_HIDE_PREDICATE, AUTO_HIDE_PREDICATE_JOINED, RANKING_EXPR } from "@/db/predicates"
import { windowCutoff } from "@/db/requests"
import type { Env } from "@/types"

export interface SongLeaderboardRow {
	videoId: string
	song: string
	artist: string
	thumbnailUrl: string | null
	demand: number
	/** Request count for `most_wanted` rows; in-window `bad_sync` report count for `needs_fixing` rows. */
	requestCount: number
	section: "most_wanted" | "needs_fixing"
	rank: number
}

interface MostWantedRow {
	video_id: string
	song: string
	artist: string
	thumbnail_url: string | null
	demand: number
	request_count: number
}

interface NeedsFixingRow {
	video_id: string
	song: string
	artist: string
	thumbnail_url: string | null
	demand: number
	report_count: number
}

async function queryMostWanted(env: Env, limit: number): Promise<MostWantedRow[]> {
	const res = await env.DB.prepare(
		`SELECT rs.video_id, rs.song, rs.artist, rs.thumbnail_url,
		        SUM(lr.weight) AS demand,
		        COUNT(*) AS request_count
		 FROM lyrics_requests lr
		 JOIN requested_songs rs ON rs.video_id = lr.video_id
		 WHERE lr.created_at > ?
		   AND NOT EXISTS (
		     SELECT 1 FROM lyrics
		     WHERE lyrics.video_id = lr.video_id
		       AND lyrics.sync_type IN ('linesync', 'richsync')
		       AND lyrics.deleted_at IS NULL
		       AND NOT ${AUTO_HIDE_PREDICATE}
		   )
		 GROUP BY rs.video_id, rs.song, rs.artist, rs.thumbnail_url
		 ORDER BY demand DESC, rs.video_id ASC
		 LIMIT ?`
	)
		.bind(windowCutoff(), limit)
		.all<MostWantedRow>()
	return res.results
}

async function queryNeedsFixing(env: Env, limit: number): Promise<NeedsFixingRow[]> {
	const res = await env.DB.prepare(
		`WITH top_synced AS (
		   SELECT DISTINCT ON (video_id) id, video_id, song, artist
		   FROM lyrics
		   WHERE sync_type IN ('linesync', 'richsync')
		     AND deleted_at IS NULL
		     AND NOT ${AUTO_HIDE_PREDICATE}
		   ORDER BY video_id, ${RANKING_EXPR} DESC
		 )
		 SELECT ts.video_id, ts.song, ts.artist, rs.thumbnail_url,
		        SUM(COALESCE(u.reputation, 1.0)) AS demand,
		        COUNT(r.id) AS report_count
		 FROM top_synced ts
		 JOIN reports r
		   ON r.lyrics_id = ts.id AND r.reason = 'bad_sync' AND r.created_at > ?
		 LEFT JOIN users u ON u.id = r.user_id
		 LEFT JOIN requested_songs rs ON rs.video_id = ts.video_id
		 GROUP BY ts.video_id, ts.song, ts.artist, rs.thumbnail_url
		 HAVING COUNT(r.id) >= ?
		 ORDER BY demand DESC, ts.video_id ASC
		 LIMIT ?`
	)
		.bind(windowCutoff(), config.requests.needsFixingReportThreshold, limit)
		.all<NeedsFixingRow>()
	return res.results
}

export async function getSongLeaderboard(
	env: Env,
	limit: number
): Promise<{ mostWanted: SongLeaderboardRow[]; needsFixing: SongLeaderboardRow[] }> {
	const [wanted, fixing] = await Promise.all([
		queryMostWanted(env, limit),
		queryNeedsFixing(env, limit),
	])

	const mostWanted: SongLeaderboardRow[] = wanted.map((r, i) => ({
		videoId: r.video_id,
		song: r.song,
		artist: r.artist,
		thumbnailUrl: r.thumbnail_url,
		demand: Number(r.demand),
		requestCount: Number(r.request_count),
		section: "most_wanted",
		rank: i + 1,
	}))

	const needsFixing: SongLeaderboardRow[] = fixing.map((r, i) => ({
		videoId: r.video_id,
		song: r.song,
		artist: r.artist,
		thumbnailUrl: r.thumbnail_url,
		demand: Number(r.demand),
		requestCount: Number(r.report_count),
		section: "needs_fixing",
		rank: i + 1,
	}))

	return { mostWanted, needsFixing }
}

export async function getSongRank(
	env: Env,
	videoId: string
): Promise<{ section: "most_wanted" | "needs_fixing"; rank: number; demand: number } | null> {
	const { mostWanted, needsFixing } = await getSongLeaderboard(
		env,
		config.requests.leaderboard.rankScanLimit
	)
	const hit =
		mostWanted.find((r) => r.videoId === videoId) ?? needsFixing.find((r) => r.videoId === videoId)
	return hit ? { section: hit.section, rank: hit.rank, demand: hit.demand } : null
}

export interface CuratorLeaderboardRow {
	keyId: string
	reputation: number
	score: number
	submissionCount: number
	totalUpvotes: number
	fulfilledCount: number
	fulfilledDemand: number
	rank: number
}

interface CuratorRow {
	key_id: string
	reputation: number
	score: number
	submission_count: number
	total_upvotes: number
	fulfilled_count: number
	fulfilled_demand: number
}

export async function getCuratorLeaderboard(
	env: Env,
	limit: number
): Promise<CuratorLeaderboardRow[]> {
	const res = await env.DB.prepare(
		`SELECT u.key_id, u.reputation,
		        agg.score, agg.submission_count, agg.total_upvotes,
		        COALESCE(ff.fulfilled_count, 0) AS fulfilled_count,
		        COALESCE(ff.fulfilled_demand, 0) AS fulfilled_demand
		 FROM (
		   SELECT submitter_id,
		          SUM(effective_score) AS score,
		          COUNT(*) AS submission_count,
		          SUM(upvotes) AS total_upvotes
		   FROM lyrics
		   WHERE deleted_at IS NULL
		     AND submitter_id IS NOT NULL
		     AND NOT ${AUTO_HIDE_PREDICATE}
		   GROUP BY submitter_id
		 ) agg
		 JOIN users u ON u.id = agg.submitter_id
		 LEFT JOIN (
		   SELECT f.submitter_id,
		          COUNT(*) AS fulfilled_count,
		          SUM(f.demand_snapshot) AS fulfilled_demand
		   FROM request_fulfillments f
		   JOIN lyrics l ON l.id = f.lyrics_id
		   WHERE l.deleted_at IS NULL AND NOT ${AUTO_HIDE_PREDICATE_JOINED}
		   GROUP BY f.submitter_id
		 ) ff ON ff.submitter_id = u.id
		 ORDER BY agg.score DESC, u.key_id ASC
		 LIMIT ?`
	)
		.bind(limit)
		.all<CuratorRow>()

	return res.results.map((r, i) => ({
		keyId: r.key_id,
		reputation: Number(r.reputation),
		score: Number(r.score),
		submissionCount: Number(r.submission_count),
		totalUpvotes: Number(r.total_upvotes),
		fulfilledCount: Number(r.fulfilled_count ?? 0),
		fulfilledDemand: Number(r.fulfilled_demand ?? 0),
		rank: i + 1,
	}))
}

export async function getCuratorRank(
	env: Env,
	keyId: string
): Promise<CuratorLeaderboardRow | null> {
	const all = await getCuratorLeaderboard(env, config.requests.leaderboard.rankScanLimit)
	return all.find((r) => r.keyId === keyId) ?? null
}
