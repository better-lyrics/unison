import { revokeConfidenceXp } from "@/db/contribution-events"
import { evictFeedCaches } from "@/db/feed"
import { invalidateCuratorLeaderboardCache } from "@/db/leaderboard"
import { invalidateCacheForSubmitter } from "@/db/lyrics"
import { updateReputations } from "@/db/reputation"
import {
	type UndoStrikeResult,
	type UnsettledStrike,
	findSuspectKeys,
	hasAnyStrike,
	lyricsVotedByKeys,
	markStrikeSettled,
	recordStrikes,
	revokeStrikeXp,
	staleLoyalLyrics,
	undoStrike,
	unsettledStrikes,
	votersOn,
} from "@/db/vote-strikes"
import { Logger } from "@/infra/logger"
import { recalculateScore } from "@/jobs/score-updater"
import type { Env } from "@/types"

const log = new Logger("cron")

export async function backfillVoteIntegrity(
	env: Env,
	now = Math.floor(Date.now() / 1000)
): Promise<{ strikes: number; keys: number } | null> {
	if (await hasAnyStrike(env)) return null
	return runVoteIntegrity(env, now, { all: true })
}

export async function runVoteIntegrity(
	env: Env,
	now = Math.floor(Date.now() / 1000),
	opts: { all?: boolean } = {}
): Promise<{ strikes: number; keys: number }> {
	const suspects = await findSuspectKeys(env, { now, all: opts.all })
	const recorded = suspects.length > 0 ? await recordStrikes(env, suspects, now) : []
	const result = {
		strikes: recorded.length,
		keys: recorded.reduce((sum, s) => sum + s.keyIds.length, 0),
	}

	let settled = 0
	for (const strike of await unsettledStrikes(env)) {
		try {
			await settleStrike(env, strike, now)
			settled++
		} catch (err) {
			log.error("vote strike settle failed", { strikeId: strike.id, error: String(err) })
		}
	}
	const swept = await sweepLoyalLyrics(env)
	if (settled === 0 && swept === 0) return result

	await evictFeedCaches(env)
	await invalidateCuratorLeaderboardCache(env)
	log.info("vote integrity", { ...result, settled, swept })
	return result
}

async function sweepLoyalLyrics(env: Env): Promise<number> {
	const bySubmitter = new Map<number, number[]>()
	let swept = 0
	for (const lyric of await staleLoyalLyrics(env)) {
		try {
			await recalculateScore(env, lyric.id)
			swept++
			if (lyric.submitterId === null) continue
			bySubmitter.set(lyric.submitterId, [...(bySubmitter.get(lyric.submitterId) ?? []), lyric.id])
		} catch (err) {
			log.error("loyal sweep recalculation failed", { lyricsId: lyric.id, error: String(err) })
		}
	}
	for (const [submitterId, ids] of bySubmitter) {
		try {
			await revokeConfidenceXp(env, submitterId, ids)
		} catch (err) {
			log.error("loyal sweep xp revoke failed", { submitterId, error: String(err) })
		}
	}
	return swept
}

async function settleStrike(env: Env, strike: UnsettledStrike, now: number): Promise<void> {
	await refreshVotedLyrics(env, strike.submitterId, strike.keyIds)
	await revokeStrikeXp(env, strike.id)
	if (strike.repeat) await invalidateCacheForSubmitter(env, strike.submitterKeyId)
	await markStrikeSettled(env, strike, now)
}

async function refreshVotedLyrics(env: Env, submitterId: number, keyIds: number[]): Promise<void> {
	const lyricsIds = await lyricsVotedByKeys(env, keyIds)
	for (const id of lyricsIds) await recalculateScore(env, id)
	const scope = new Set([submitterId, ...keyIds, ...(await votersOn(env, lyricsIds))])
	await updateReputations(env, [...scope])
}

export async function undoVoteStrike(
	env: Env,
	strikeId: number,
	actorId: number,
	now = Math.floor(Date.now() / 1000)
): Promise<UndoStrikeResult> {
	const undone = await undoStrike(env, strikeId, actorId, now)
	if (undone.result !== "undone" || undone.submitterId === null) return undone.result

	await refreshVotedLyrics(env, undone.submitterId, undone.keyIds)
	if (undone.repeatChanged && undone.submitterKeyId !== null) {
		await invalidateCacheForSubmitter(env, undone.submitterKeyId)
	}
	await evictFeedCaches(env)
	await invalidateCuratorLeaderboardCache(env)
	log.info("vote strike undone", { strikeId, actorId, keys: undone.keyIds.length })
	return undone.result
}
