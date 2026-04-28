import { invalidateCache } from "@/db/lyrics"
import { Logger } from "@/infra/logger"
import { recalculateScore } from "@/jobs/score-updater"
import type { Env } from "@/types"
import { updateUserAvgVote } from "./users"

const log = new Logger("db")

export async function castVote(
	env: Env,
	lyricsId: number,
	userId: number,
	vote: 1 | -1
): Promise<{ success: boolean; message: string }> {
	const lyrics = await env.DB.prepare("SELECT submitter_id, video_id FROM lyrics WHERE id = ?")
		.bind(lyricsId)
		.first<{ submitter_id: number | null; video_id: string }>()

	const isSelfVote = lyrics?.submitter_id === userId ? 1 : 0

	const existing = await env.DB.prepare(
		"SELECT vote FROM votes WHERE lyrics_id = ? AND user_id = ?"
	)
		.bind(lyricsId, userId)
		.first<{ vote: number }>()

	if (existing) {
		if (existing.vote === vote) {
			return { success: false, message: "Already voted" }
		}

		await env.DB.batch([
			env.DB.prepare(
				"UPDATE votes SET vote = ?, created_at = EXTRACT(EPOCH FROM NOW())::INTEGER WHERE lyrics_id = ? AND user_id = ?"
			).bind(vote, lyricsId, userId),
			env.DB.prepare(
				`
				UPDATE lyrics SET
					upvotes = upvotes + CASE WHEN ? = 1 THEN 1 ELSE -1 END,
					downvotes = downvotes + CASE WHEN ? = -1 THEN 1 ELSE -1 END,
					score = score + (? * 2),
					updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
				WHERE id = ?
				`
			).bind(vote, vote, vote, lyricsId),
		])

		if (lyrics) await invalidateCache(env, lyrics.video_id)
		await updateUserAvgVote(env, userId)
		recalculateScore(env, lyricsId).catch((err) =>
			log.error("background recalculation failed", { lyricsId, error: String(err) })
		)
		log.info("vote changed", { lyricsId, userId, vote })
		return { success: true, message: "Vote updated" }
	}

	await env.DB.batch([
		env.DB.prepare(
			"INSERT INTO votes (lyrics_id, user_id, vote, is_self_vote) VALUES (?, ?, ?, ?)"
		).bind(lyricsId, userId, vote, isSelfVote),
		env.DB.prepare(
			`
			UPDATE lyrics SET
				upvotes = upvotes + CASE WHEN ? = 1 THEN 1 ELSE 0 END,
				downvotes = downvotes + CASE WHEN ? = -1 THEN 1 ELSE 0 END,
				score = score + ?,
				vote_count = vote_count + 1,
				updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
			WHERE id = ?
			`
		).bind(vote, vote, vote, lyricsId),
	])

	if (lyrics) await invalidateCache(env, lyrics.video_id)
	await updateUserAvgVote(env, userId)
	recalculateScore(env, lyricsId).catch((err) =>
		log.error("background recalculation failed", { lyricsId, error: String(err) })
	)
	log.info("vote cast", { lyricsId, userId, vote, selfVote: !!isSelfVote })
	return { success: true, message: "Vote recorded" }
}

export async function getUserVote(
	env: Env,
	lyricsId: number,
	userId: number
): Promise<1 | -1 | null> {
	const row = await env.DB.prepare("SELECT vote FROM votes WHERE lyrics_id = ? AND user_id = ?")
		.bind(lyricsId, userId)
		.first<{ vote: number }>()
	return (row?.vote as 1 | -1) ?? null
}

export async function getUserVotesForIds(
	env: Env,
	lyricsIds: number[],
	userId: number
): Promise<Map<number, 1 | -1>> {
	if (lyricsIds.length === 0) return new Map()
	const placeholders = lyricsIds.map(() => "?").join(", ")
	const result = await env.DB.prepare(
		`SELECT lyrics_id, vote FROM votes WHERE user_id = ? AND lyrics_id IN (${placeholders})`
	)
		.bind(userId, ...lyricsIds)
		.all<{ lyrics_id: number; vote: number }>()
	const map = new Map<number, 1 | -1>()
	for (const row of result.results) {
		map.set(row.lyrics_id, row.vote as 1 | -1)
	}
	return map
}

export async function removeVote(
	env: Env,
	lyricsId: number,
	userId: number
): Promise<{ success: boolean; message: string }> {
	const existing = await env.DB.prepare(
		`SELECT v.vote, l.video_id
		 FROM votes v
		 JOIN lyrics l ON l.id = v.lyrics_id
		 WHERE v.lyrics_id = ? AND v.user_id = ?`
	)
		.bind(lyricsId, userId)
		.first<{ vote: number; video_id: string }>()

	if (!existing) {
		return { success: false, message: "No vote to remove" }
	}

	const vote = existing.vote

	await env.DB.batch([
		env.DB.prepare("DELETE FROM votes WHERE lyrics_id = ? AND user_id = ?").bind(lyricsId, userId),
		env.DB.prepare(
			`
			UPDATE lyrics SET
				upvotes = upvotes - CASE WHEN ? = 1 THEN 1 ELSE 0 END,
				downvotes = downvotes - CASE WHEN ? = -1 THEN 1 ELSE 0 END,
				score = score - ?,
				vote_count = vote_count - 1,
				updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
			WHERE id = ?
			`
		).bind(vote, vote, vote, lyricsId),
	])

	await invalidateCache(env, existing.video_id)
	await updateUserAvgVote(env, userId)
	recalculateScore(env, lyricsId).catch((err) =>
		log.error("background recalculation failed", { lyricsId, error: String(err) })
	)
	log.info("vote removed", { lyricsId, userId })
	return { success: true, message: "Vote removed" }
}
