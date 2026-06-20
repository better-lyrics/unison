import { config } from "@/config"
import type { Env } from "@/types"
import { notify } from "@/utils/ntfy"
import { type DriftResult, type Histogram, checkDrift } from "@/utils/threshold-derive"

const HIST_KEYS = [2, 3, 4, 5, 6, 7, 8, 9, 10]

function atLeastSelect(valueExpr: string): string {
	return HIST_KEYS.map((k) => `COUNT(*) FILTER (WHERE ${valueExpr} >= ${k}) AS at_least_${k}`).join(
		",\n\t\t\t"
	)
}

type HistRow = { total: number } & Record<string, number>

function toHistogram(row: HistRow | null): Histogram {
	if (!row) return { total: 0, atLeast: {} }
	const atLeast: Record<number, number> = {}
	// node-pg returns bigint COUNT(*) columns as strings, so coerce to number
	for (const k of HIST_KEYS) atLeast[k] = Number(row[`at_least_${k}`] ?? 0)
	return { total: Number(row.total ?? 0), atLeast }
}

async function lyricsHistogram(env: Env, where: string): Promise<Histogram> {
	const row = await env.DB.prepare(`
		SELECT COUNT(*) AS total,
			${atLeastSelect("vote_count")}
		FROM lyrics
		WHERE ${where}
	`).first<HistRow>()
	return toHistogram(row)
}

async function reportsHistogram(env: Env): Promise<Histogram> {
	// denominator is lyrics with at least one report, so coverage is over reported rows
	const row = await env.DB.prepare(`
		SELECT COUNT(*) AS total,
			${atLeastSelect("c")}
		FROM (SELECT COUNT(*) AS c FROM reports GROUP BY lyrics_id) g
	`).first<HistRow>()
	return toHistogram(row)
}

interface Audited {
	name: string
	current: number
	target: { targetFraction: number; floor: number; ceil: number }
	histogram: (env: Env) => Promise<Histogram>
}

function registry(): Audited[] {
	const t = config.thresholdAudit.targets
	const ah = config.moderation.autoHide
	return [
		// positive incumbents are the promotion candidates these bars gate, so derive over them
		{
			name: "minVotesForConfidence",
			current: config.reputation.minVotesForConfidence,
			target: t.minVotesForConfidence,
			histogram: (env) => lyricsHistogram(env, "effective_score > 0 AND deleted_at IS NULL"),
		},
		{
			name: "primarySlotMinVotes",
			current: config.ranking.primarySlot.minVotes,
			target: t.primarySlotMinVotes,
			histogram: (env) => lyricsHistogram(env, "effective_score > 0 AND deleted_at IS NULL"),
		},
		{
			name: "autoHideMinVotes",
			current: config.moderation.autoHide.minVotes,
			target: t.autoHideMinVotes,
			histogram: (env) =>
				lyricsHistogram(
					env,
					`vote_count > 0 AND downvotes >= ${ah.downvoteRatio} * vote_count AND effective_score < ${ah.maxEffectiveScore} AND deleted_at IS NULL`
				),
		},
		{
			name: "autoHideDecisiveMinVotes",
			current: config.moderation.autoHide.decisiveMinVotes,
			target: t.autoHideDecisiveMinVotes,
			histogram: (env) =>
				lyricsHistogram(
					env,
					`vote_count > 0 AND downvotes = vote_count AND EXTRACT(EPOCH FROM NOW())::INTEGER - created_at >= ${ah.decisiveMinAgeDays * 86400} AND deleted_at IS NULL`
				),
		},
		{
			name: "reportsThreshold",
			current: config.moderation.reportsThreshold,
			target: t.reportsThreshold,
			histogram: reportsHistogram,
		},
	]
}

function formatMessage(drifts: DriftResult[]): string {
	return drifts
		.map(
			(d) =>
				`${d.name}: ${d.current} -> ${d.recommended} (coverage ${(d.currentCoverage * 100).toFixed(1)}% vs target ${(d.targetFraction * 100).toFixed(0)}%)`
		)
		.join("\n")
}

export async function auditThresholds(
	env: Env
): Promise<{ checked: number; drifted: string[]; notified: boolean }> {
	const items = registry()
	const results: DriftResult[] = []

	for (const item of items) {
		const hist = await item.histogram(env)
		const result = checkDrift({
			name: item.name,
			hist,
			current: item.current,
			targetFraction: item.target.targetFraction,
			floor: item.target.floor,
			ceil: item.target.ceil,
			tolerance: config.thresholdAudit.driftTolerance,
		})
		results.push(result)
	}

	const drifted = results.filter((r) => r.drifted)

	const fresh: DriftResult[] = []
	for (const d of drifted) {
		const key = `audit:lastNotified:${d.name}`
		const last = await env.CACHE.get(key)
		if (last === String(d.recommended)) continue
		fresh.push(d)
	}

	let notified = false
	if (fresh.length > 0) {
		notified = await notify(formatMessage(fresh), { title: "Threshold drift detected" })
		if (notified) {
			for (const d of fresh) {
				await env.CACHE.put(`audit:lastNotified:${d.name}`, String(d.recommended))
			}
		}
	}

	return { checked: results.length, drifted: drifted.map((d) => d.name), notified }
}
