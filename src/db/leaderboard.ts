import { config } from "@/config"
import { AUTO_HIDE_PREDICATE, RANKING_EXPR } from "@/db/lyrics"
import { windowCutoff } from "@/db/requests"
import type { Env } from "@/types"

export interface SongLeaderboardRow {
	videoId: string
	song: string
	artist: string
	thumbnailUrl: string | null
	demand: number
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
		 ORDER BY demand DESC
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
		 ORDER BY demand DESC
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
		mostWanted.find((r) => r.videoId === videoId) ??
		needsFixing.find((r) => r.videoId === videoId)
	return hit ? { section: hit.section, rank: hit.rank, demand: hit.demand } : null
}
