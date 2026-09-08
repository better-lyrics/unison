import { config } from "@/config"
import { CONSENSUS_LYRICS_CTE } from "@/db/predicates"
import type { Confidence, Env } from "@/types"

export interface ContributionEvent {
	userId: number
	delta: number
	kind: string
	refType: string
	refId: number
}

export async function addEvent(env: Env, event: ContributionEvent): Promise<boolean> {
	const row = await env.DB.prepare(
		`INSERT INTO contribution_events (user_id, delta, kind, ref_type, ref_id)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT (user_id, kind, ref_type, ref_id) DO NOTHING
		 RETURNING id`
	)
		.bind(event.userId, event.delta, event.kind, event.refType, event.refId)
		.first<{ id: number }>()
	return row !== null
}

export async function awardConfidenceXp(
	env: Env,
	submitterId: number,
	lyricsId: number,
	confidence: Confidence
): Promise<void> {
	if (confidence === "medium" || confidence === "high") {
		await addEvent(env, {
			userId: submitterId,
			delta: config.gamification.xp.weights.reachedMedium,
			kind: "reached-medium",
			refType: "lyric",
			refId: lyricsId,
		})
	}
	if (confidence === "high") {
		await addEvent(env, {
			userId: submitterId,
			delta: config.gamification.xp.weights.reachedHigh,
			kind: "reached-high",
			refType: "lyric",
			refId: lyricsId,
		})
	}
}

export async function awardRequestFilledXp(
	env: Env,
	fillerId: number,
	fulfillmentId: number
): Promise<boolean> {
	return addEvent(env, {
		userId: fillerId,
		delta: config.gamification.xp.weights.requestFilled,
		kind: "request-filled",
		refType: "fulfillment",
		refId: fulfillmentId,
	})
}

export async function awardFirstForSongXp(
	env: Env,
	submitterId: number,
	lyricsId: number,
	videoId: string,
	confidence: Confidence
): Promise<boolean> {
	if (confidence !== "medium" && confidence !== "high") return false
	const earliest = await env.DB.prepare(
		"SELECT MIN(id) AS min_id FROM lyrics WHERE video_id = ? AND deleted_at IS NULL"
	)
		.bind(videoId)
		.first<{ min_id: number | null }>()
	if (!earliest || Number(earliest.min_id) !== lyricsId) return false
	return addEvent(env, {
		userId: submitterId,
		delta: config.gamification.xp.weights.firstForSong,
		kind: "first-for-song",
		refType: "lyric",
		refId: lyricsId,
	})
}

export async function awardPenaltyXp(
	env: Env,
	submitterId: number,
	lyricsId: number
): Promise<boolean> {
	return addEvent(env, {
		userId: submitterId,
		delta: config.gamification.xp.weights.penalized,
		kind: "penalized",
		refType: "lyric",
		refId: lyricsId,
	})
}

export async function awardConsensusVotes(env: Env): Promise<void> {
	await env.DB.prepare(`${CONSENSUS_LYRICS_CTE}
		INSERT INTO contribution_events (user_id, delta, kind, ref_type, ref_id)
		SELECT v.user_id, ?, 'consensus-vote', 'lyric', v.lyrics_id
		FROM votes v
		JOIN consensus_lyrics cl ON v.lyrics_id = cl.id
		WHERE v.vote = cl.consensus AND v.is_self_vote = 0
		ON CONFLICT (user_id, kind, ref_type, ref_id) DO NOTHING`)
		.bind(config.reputation.minVotesForConfidence, config.gamification.xp.weights.consensusVote)
		.run()
}

export async function getXp(env: Env, userId: number): Promise<number> {
	const row = await env.DB.prepare(
		"SELECT COALESCE(SUM(delta), 0) AS xp FROM contribution_events WHERE user_id = ?"
	)
		.bind(userId)
		.first<{ xp: string | number }>()
	return Number(row?.xp ?? 0)
}

export async function getXpForUsers(env: Env, userIds: number[]): Promise<Map<number, number>> {
	const xp = new Map<number, number>()
	if (userIds.length === 0) return xp
	const placeholders = userIds.map(() => "?").join(", ")
	const res = await env.DB.prepare(
		`SELECT user_id, COALESCE(SUM(delta), 0) AS xp
		 FROM contribution_events
		 WHERE user_id IN (${placeholders})
		 GROUP BY user_id`
	)
		.bind(...userIds)
		.all<{ user_id: number; xp: string | number }>()
	for (const row of res.results) {
		xp.set(Number(row.user_id), Number(row.xp))
	}
	return xp
}
