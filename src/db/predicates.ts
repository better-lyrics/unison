import { config } from "@/config"

const { syncTypeBoost } = config.ranking
const buildRankingExpr = (prefix: string, committeeBonus = false) => {
	const syncTypeBoostExpr = `CASE ${prefix}sync_type
		WHEN 'richsync' THEN ${syncTypeBoost.richsync}
		WHEN 'linesync' THEN ${syncTypeBoost.linesync}
		ELSE ${syncTypeBoost.plain}
	END`
	const committeeBonusExpr = committeeBonus
		? ` + CASE WHEN ${prefix}committee_approved_at IS NOT NULL THEN ${config.gamification.boost.rankingBonus} ELSE 0 END`
		: ""
	return `(
		(${prefix}effective_score * LN(${prefix}vote_count + ${config.ranking.confidenceBase})
		+ ${config.ranking.recencyWeight} / (1.0 + (EXTRACT(EPOCH FROM NOW())::INTEGER - ${prefix}created_at) / 86400.0)${committeeBonusExpr})
		* ${syncTypeBoostExpr}
	)`
}

export const RANKING_EXPR = buildRankingExpr("")
export const RANKING_EXPR_JOINED = buildRankingExpr("l.", true)

const { autoHide } = config.moderation

const buildAutoHidePredicate = (prefix: string) => `(
	(
		${prefix}vote_count >= ${autoHide.minVotes}
		AND ${prefix}downvotes >= ${autoHide.downvoteRatio} * ${prefix}vote_count
		AND ${prefix}effective_score < ${autoHide.maxEffectiveScore}
	)
	OR
	(
		${prefix}vote_count >= ${autoHide.decisiveMinVotes}
		AND ${prefix}downvotes = ${prefix}vote_count
		AND EXTRACT(EPOCH FROM NOW())::INTEGER - ${prefix}created_at >= ${autoHide.decisiveMinAgeDays * 86400}
	)
)`

export const AUTO_HIDE_PREDICATE = buildAutoHidePredicate("")
export const AUTO_HIDE_PREDICATE_JOINED = buildAutoHidePredicate("l.")

const { primarySlot } = config.ranking

const provenExpr = (repExpr: string, prefix: string) => `(
	COALESCE(${repExpr}, 0) > ${primarySlot.repFloor}
	OR (
		${prefix}vote_count >= ${primarySlot.minVotes}
		AND ${prefix}effective_score > 0
	)
	OR ${prefix}committee_approved_at IS NOT NULL
)`

export const PROVEN_EXPR_JOINED = provenExpr("u.reputation", "l.")
