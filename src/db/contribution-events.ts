import { config } from "@/config"
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
	lyricsId: number
): Promise<boolean> {
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

export async function getXp(env: Env, userId: number): Promise<number> {
	const row = await env.DB.prepare(
		"SELECT COALESCE(SUM(delta), 0) AS xp FROM contribution_events WHERE user_id = ?"
	)
		.bind(userId)
		.first<{ xp: string | number }>()
	return Number(row?.xp ?? 0)
}
