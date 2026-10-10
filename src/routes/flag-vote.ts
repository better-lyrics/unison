import { config } from "@/config"
import { evictFeedCaches } from "@/db/feed"
import type { FlagTally, FlagVoteResult } from "@/db/flags"
import { invalidateCacheForLyric } from "@/db/lyrics"
import type { Env } from "@/types"
import { ErrorCode, type SubmissionErrorBody, buildError } from "@/utils/errors"

type FlagVoteFailure = Extract<FlagVoteResult, { ok: false }>["reason"]
type FlagVoteSuccess = Extract<FlagVoteResult, { ok: true }>

const FLAG_VOTE_ERROR: Record<FlagVoteFailure, { status: number; code: ErrorCode; hint?: string }> =
	{
		not_committee: { status: 403, code: ErrorCode.NOT_COMMITTEE },
		not_found: { status: 404, code: ErrorCode.NOT_FOUND },
		already_decided: {
			status: 409,
			code: ErrorCode.ALREADY_DECIDED,
			hint: "Another council member already decided this flag. Refresh the dashboard.",
		},
		conflict: { status: 409, code: ErrorCode.FLAG_CONFLICT },
	}

export function flagVoteError(reason: FlagVoteFailure): {
	status: number
	body: SubmissionErrorBody
} {
	const { status, code, hint } = FLAG_VOTE_ERROR[reason]
	return { status, body: buildError(code, hint ? { hint } : undefined) }
}

export async function settleFlagVote(
	env: Env,
	result: FlagVoteSuccess
): Promise<FlagTally & Pick<FlagVoteSuccess, "status"> & { needed: number }> {
	const data = {
		status: result.status,
		removals: result.removals,
		keeps: result.keeps,
		needed: config.council.reportFlags.removals,
	}
	if (result.status === "open") return data
	// Evicting inside the vote transaction runs before commit, so a concurrent read could refill it.
	await invalidateCacheForLyric(env, result.lyricsId)
	await evictFeedCaches(env)
	return data
}
