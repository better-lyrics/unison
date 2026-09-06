import { getFulfillmentStatsBySubmitter } from "@/db/fulfillments"
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

async function scalar(env: Env, sql: string, userId: number): Promise<number> {
	const row = await env.DB.prepare(sql).bind(userId).first<{ n: string | number }>()
	return Number(row?.n ?? 0)
}

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
