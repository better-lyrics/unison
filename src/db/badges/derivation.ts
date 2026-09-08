import { config } from "@/config"
import { getFulfillmentStatsBySubmitter } from "@/db/fulfillments"
import { AUTO_HIDE_PREDICATE_JOINED, PROVEN_EXPR_JOINED, RANKING_EXPR_VARIANT } from "@/db/predicates"
import type { Env } from "@/types"
import { isLinkBlacklisted } from "@/utils/blacklist"
import { BADGES } from "./definitions"

export interface BadgeProgress {
	current: number
	next: number | null
}

export interface BadgeEvaluation {
	earned: boolean
	tier?: number
	progress?: BadgeProgress
}

export type Evaluator = (env: Env, userId: number) => Promise<BadgeEvaluation>

const thresholdsByKey = new Map<string, number[]>()
for (const b of BADGES) {
	if (b.tiers)
		thresholdsByKey.set(
			b.key,
			b.tiers.map((t) => t.threshold)
		)
}

function thresholdsFor(key: string): number[] {
	const thresholds = thresholdsByKey.get(key)
	if (!thresholds) throw new Error(`no tiers defined for badge ${key}`)
	return thresholds
}

function tiered(current: number, thresholds: number[]): BadgeEvaluation {
	let tier = 0
	for (const t of thresholds) {
		if (current >= t) tier++
	}
	const next = tier < thresholds.length ? thresholds[tier] : null
	return { earned: tier > 0, tier: tier > 0 ? tier : undefined, progress: { current, next } }
}

async function scalar(env: Env, sql: string, ...params: unknown[]): Promise<number> {
	const row = await env.DB.prepare(sql)
		.bind(...params)
		.first<{ n: string | number }>()
	return Number(row?.n ?? 0)
}

// Weeks and months a user showed up: real submissions plus non-self votes. Bound twice (votes, lyrics).
const ACTIVITY_CTE = `WITH activity AS (
	SELECT created_at FROM votes WHERE user_id = ? AND is_self_vote = 0
	UNION ALL
	SELECT created_at FROM lyrics WHERE submitter_id = ? AND deleted_at IS NULL
)`

export const DERIVATIONS: Record<string, Evaluator> = {
	"verified-contributor": async (env, userId) => {
		const count = await scalar(
			env,
			"SELECT COUNT(*) AS n FROM lyrics WHERE submitter_id = ? AND deleted_at IS NULL AND confidence IN ('medium','high')",
			userId
		)
		return tiered(count, thresholdsFor("verified-contributor"))
	},

	polyglot: async (env, userId) => {
		const count = await scalar(
			env,
			"SELECT COUNT(DISTINCT language) AS n FROM lyrics WHERE submitter_id = ? AND deleted_at IS NULL AND confidence IN ('medium','high') AND language IS NOT NULL",
			userId
		)
		return tiered(count, thresholdsFor("polyglot"))
	},

	prolific: async (env, userId) => {
		const count = await scalar(
			env,
			"SELECT COUNT(*) AS n FROM lyrics WHERE submitter_id = ? AND deleted_at IS NULL AND reputation_penalized = FALSE",
			userId
		)
		return tiered(count, thresholdsFor("prolific"))
	},

	firefighter: async (env, userId) => {
		const count = await scalar(
			env,
			"SELECT COUNT(*) AS n FROM request_fulfillments WHERE submitter_id = ? AND demand_snapshot >= ?",
			userId,
			config.gamification.badges.firefighterMinDemand
		)
		return tiered(count, thresholdsFor("firefighter"))
	},

	"karaoke-master": async (env, userId) => {
		const count = await scalar(
			env,
			"SELECT COUNT(*) AS n FROM lyrics WHERE submitter_id = ? AND deleted_at IS NULL AND confidence IN ('medium','high') AND sync_type = 'richsync'",
			userId
		)
		return tiered(count, thresholdsFor("karaoke-master"))
	},

	"line-dancer": async (env, userId) => {
		const count = await scalar(
			env,
			"SELECT COUNT(*) AS n FROM lyrics WHERE submitter_id = ? AND deleted_at IS NULL AND confidence IN ('medium','high') AND sync_type = 'linesync'",
			userId
		)
		return tiered(count, thresholdsFor("line-dancer"))
	},

	"rarity-hunter": async (env, userId) => {
		const common = config.gamification.badges.rarityCommonLanguages
		const placeholders = common.map(() => "?").join(", ")
		const count = await scalar(
			env,
			`SELECT COUNT(DISTINCT language) AS n FROM lyrics
			 WHERE submitter_id = ? AND deleted_at IS NULL AND confidence IN ('medium','high')
			   AND language IS NOT NULL AND language NOT IN (${placeholders})`,
			userId,
			...common
		)
		return tiered(count, thresholdsFor("rarity-hunter"))
	},

	tastemaker: async (env, userId) => {
		const { winnerScore, earlyWindow } = config.gamification.badges.tastemaker
		const count = await scalar(
			env,
			`SELECT COUNT(*) AS n FROM votes v
			 JOIN lyrics l ON l.id = v.lyrics_id
			 WHERE v.user_id = ? AND v.vote = 1 AND v.is_self_vote = 0
			   AND l.deleted_at IS NULL AND l.effective_score >= ?
			   AND (SELECT COUNT(*) FROM votes v2 WHERE v2.lyrics_id = v.lyrics_id AND v2.created_at < v.created_at) < ?`,
			userId,
			winnerScore,
			earlyWindow
		)
		return tiered(count, thresholdsFor("tastemaker"))
	},

	guardian: async (env, userId) => {
		const count = await scalar(
			env,
			`SELECT COUNT(*) AS n FROM reports r
			 JOIN lyrics l ON l.id = r.lyrics_id
			 WHERE r.user_id = ?
			   AND (l.reputation_penalized = TRUE OR (l.deleted_at IS NOT NULL AND l.deleted_by_role = 'admin'))`,
			userId
		)
		return tiered(count, thresholdsFor("guardian"))
	},

	"fan-favorite": async (env, userId) => {
		const count = await scalar(
			env,
			"SELECT COUNT(*) AS n FROM lyrics WHERE submitter_id = ? AND deleted_at IS NULL AND (upvotes - downvotes) >= ?",
			userId,
			config.gamification.badges.fanFavoriteMinNet
		)
		return { earned: count > 0 }
	},

	flawless: async (env, userId) => {
		const count = await scalar(
			env,
			"SELECT COUNT(*) AS n FROM lyrics WHERE submitter_id = ? AND deleted_at IS NULL AND downvotes = 0 AND upvotes >= ?",
			userId,
			config.gamification.badges.flawlessMinVotes
		)
		return { earned: count > 0 }
	},

	perfectionist: async (env, userId) => {
		const count = await scalar(
			env,
			"SELECT COUNT(*) AS n FROM lyrics WHERE submitter_id = ? AND deleted_at IS NULL AND diversity_bonus = 1 AND effective_score >= ?",
			userId,
			config.gamification.badges.perfectionistMinScore
		)
		return { earned: count > 0 }
	},

	"early-adopter": async (env, userId) => {
		const count = await scalar(
			env,
			"SELECT COUNT(*) AS n FROM users WHERE id = ? AND created_at < ?",
			userId,
			config.gamification.badges.earlyAdopterCutoff
		)
		return { earned: count > 0 }
	},

	"on-a-roll": async (env, userId) => {
		const streak = await scalar(
			env,
			`${ACTIVITY_CTE},
			 weeks AS (
				SELECT DISTINCT
					(EXTRACT(EPOCH FROM date_trunc('week', to_timestamp(created_at) AT TIME ZONE 'UTC'))::bigint / 604800) AS wk
				FROM activity
			 ),
			 runs AS (
				SELECT wk - ROW_NUMBER() OVER (ORDER BY wk) AS grp FROM weeks
			 )
			 SELECT COALESCE(MAX(cnt), 0) AS n FROM (SELECT COUNT(*) AS cnt FROM runs GROUP BY grp) t`,
			userId,
			userId
		)
		return tiered(streak, thresholdsFor("on-a-roll"))
	},

	regular: async (env, userId) => {
		const months = await scalar(
			env,
			`${ACTIVITY_CTE}
			 SELECT COUNT(DISTINCT date_trunc('month', to_timestamp(created_at) AT TIME ZONE 'UTC')) AS n FROM activity`,
			userId,
			userId
		)
		return tiered(months, thresholdsFor("regular"))
	},

	evergreen: async (env, userId) => {
		const count = await scalar(
			env,
			`SELECT COUNT(*) AS n FROM lyrics le
			 WHERE le.submitter_id = ?
			   AND le.deleted_at IS NULL
			   AND le.created_at <= (EXTRACT(EPOCH FROM NOW())::INTEGER - ?)
			   AND le.id = (
				 SELECT l.id FROM lyrics l
				 LEFT JOIN users u ON u.id = l.submitter_id
				 WHERE l.video_id = le.video_id AND l.deleted_at IS NULL AND NOT ${AUTO_HIDE_PREDICATE_JOINED}
				 ORDER BY (CASE WHEN ${PROVEN_EXPR_JOINED} THEN 1 ELSE 0 END) DESC, ${RANKING_EXPR_VARIANT} DESC
				 LIMIT 1
			   )`,
			userId,
			config.gamification.badges.evergreenMinDays * 86400
		)
		return { earned: count > 0 }
	},

	"sharp-ear": async (env, userId) => {
		const count = await scalar(
			env,
			"SELECT COUNT(*) AS n FROM contribution_events WHERE user_id = ? AND kind = 'consensus-vote'",
			userId
		)
		return tiered(count, thresholdsFor("sharp-ear"))
	},

	trailblazer: async (env, userId) => {
		const count = await scalar(
			env,
			"SELECT COUNT(*) AS n FROM contribution_events WHERE user_id = ? AND kind = 'first-for-song'",
			userId
		)
		return tiered(count, thresholdsFor("trailblazer"))
	},

	"first-responder": async (env, userId) => {
		const { fulfilledCount } = await getFulfillmentStatsBySubmitter(env, userId)
		return tiered(fulfilledCount, thresholdsFor("first-responder"))
	},

	"most-loved": async (env, userId) => {
		const count = await scalar(
			env,
			"SELECT COUNT(*) AS n FROM lyrics WHERE submitter_id = ? AND deleted_at IS NULL AND effective_score >= 0.9 AND vote_count >= 25",
			userId
		)
		return { earned: count > 0 }
	},

	"first-submission": async (env, userId) => {
		const count = await scalar(
			env,
			"SELECT COUNT(*) AS n FROM lyrics WHERE submitter_id = ? AND deleted_at IS NULL",
			userId
		)
		return { earned: count > 0 }
	},

	committee: async (env, userId) => {
		const count = await scalar(
			env,
			"SELECT COUNT(*) AS n FROM committee_members WHERE user_id = ?",
			userId
		)
		return { earned: count > 0 }
	},

	community: async (env, userId) => {
		const row = await env.DB.prepare("SELECT key_id FROM users WHERE id = ?")
			.bind(userId)
			.first<{ key_id: string }>()
		return { earned: row !== null && isLinkBlacklisted(row.key_id) }
	},
}
