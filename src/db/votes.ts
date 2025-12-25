import type { Env } from "@/types"
import { updateUserAvgVote } from "./users"

export async function castVote(
	env: Env,
	lyricsId: number,
	userId: number,
	vote: 1 | -1
): Promise<{ success: boolean; message: string }> {
	// Check if this is a self-vote
	const lyrics = await env.DB.prepare("SELECT submitter_id FROM lyrics WHERE id = ?")
		.bind(lyricsId)
		.first<{ submitter_id: number | null }>()

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
				"UPDATE votes SET vote = ?, created_at = unixepoch() WHERE lyrics_id = ? AND user_id = ?"
			).bind(vote, lyricsId, userId),
			env.DB.prepare(
				`
				UPDATE lyrics SET
					upvotes = upvotes + CASE WHEN ? = 1 THEN 1 ELSE -1 END,
					downvotes = downvotes + CASE WHEN ? = -1 THEN 1 ELSE -1 END,
					score = score + (? * 2),
					updated_at = unixepoch()
				WHERE id = ?
				`
			).bind(vote, vote, vote, lyricsId),
		])

		await updateUserAvgVote(env, userId)
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
				updated_at = unixepoch()
			WHERE id = ?
			`
		).bind(vote, vote, vote, lyricsId),
	])

	await updateUserAvgVote(env, userId)
	return { success: true, message: "Vote recorded" }
}

export async function removeVote(
	env: Env,
	lyricsId: number,
	userId: number
): Promise<{ success: boolean; message: string }> {
	const existing = await env.DB.prepare(
		"SELECT vote FROM votes WHERE lyrics_id = ? AND user_id = ?"
	)
		.bind(lyricsId, userId)
		.first<{ vote: number }>()

	if (!existing) {
		return { success: false, message: "No vote to remove" }
	}

	const vote = existing.vote

	await env.DB.batch([
		env.DB.prepare("DELETE FROM votes WHERE lyrics_id = ? AND user_id = ?").bind(
			lyricsId,
			userId
		),
		env.DB.prepare(
			`
			UPDATE lyrics SET
				upvotes = upvotes - CASE WHEN ? = 1 THEN 1 ELSE 0 END,
				downvotes = downvotes - CASE WHEN ? = -1 THEN 1 ELSE 0 END,
				score = score - ?,
				updated_at = unixepoch()
			WHERE id = ?
			`
		).bind(vote, vote, vote, lyricsId),
	])

	await updateUserAvgVote(env, userId)
	return { success: true, message: "Vote removed" }
}
