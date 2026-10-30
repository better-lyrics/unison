import { awardStrikePenaltyXp } from "@/db/contribution-events"
import { recordCouncilEvent } from "@/db/council-events"
import { evictFeedCaches } from "@/db/feed"
import { invalidateCuratorLeaderboardCache } from "@/db/leaderboard"
import { updateReputations } from "@/db/reputation"
import {
	type UndoStrikeResult,
	findSuspectKeys,
	getStrikeSummary,
	lyricsVotedByKeys,
	recordStrikes,
	revokeStrikeXp,
	strikeNote,
	undoStrike,
} from "@/db/vote-strikes"
import { Logger } from "@/infra/logger"
import { recalculateScore } from "@/jobs/score-updater"
import type { Env } from "@/types"

const log = new Logger("cron")

export async function runVoteIntegrity(
	env: Env,
	now = Math.floor(Date.now() / 1000)
): Promise<{ strikes: number; keys: number }> {
	const suspects = await findSuspectKeys(env)
	if (suspects.length === 0) return { strikes: 0, keys: 0 }

	const recorded = await recordStrikes(env, suspects, now)
	for (const strike of recorded) {
		for (const id of await lyricsVotedByKeys(env, strike.keyIds)) {
			await recalculateScore(env, id)
		}
		await revokeStrikeXp(env, strike.strikeId)
		if (!strike.created) continue
		if (strike.repeat) await awardStrikePenaltyXp(env, strike.submitterId, strike.strikeId)
		const summary = await getStrikeSummary(env, strike.strikeId)
		await recordCouncilEvent(env.DB, {
			actorId: null,
			kind: "vote_strike",
			source: "system",
			subjectUserId: strike.submitterId,
			refId: strike.strikeId,
			note: summary ? strikeNote(summary) : null,
			at: now,
		})
	}

	const result = {
		strikes: recorded.length,
		keys: recorded.reduce((sum, s) => sum + s.keyIds.length, 0),
	}
	if (result.strikes === 0) return result

	await updateReputations(env)
	await evictFeedCaches(env)
	await invalidateCuratorLeaderboardCache(env)
	log.info("vote integrity", result)
	return result
}

export async function undoVoteStrike(
	env: Env,
	strikeId: number,
	actorId: number,
	now = Math.floor(Date.now() / 1000)
): Promise<UndoStrikeResult> {
	const { result, keyIds } = await undoStrike(env, strikeId, actorId, now)
	if (result !== "undone") return result

	for (const id of await lyricsVotedByKeys(env, keyIds)) {
		await recalculateScore(env, id)
	}
	await updateReputations(env)
	await evictFeedCaches(env)
	await invalidateCuratorLeaderboardCache(env)
	log.info("vote strike undone", { strikeId, actorId, keys: keyIds.length })
	return result
}
