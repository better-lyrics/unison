import { config } from "@/config"
import { type BadgeDef, CATALOGUE } from "@/db/badges/definitions"
import type { BadgeRef, Env } from "@/types"

const DEF_BY_KEY = new Map<string, BadgeDef>(CATALOGUE.map((def) => [def.key, def]))
const CATEGORY_ORDER = config.gamification.display.categoryOrder

export interface BadgeSummary {
	badgeCount: number
	topBadge: BadgeRef | null
}

interface AwardRow {
	user_id: number | string
	badge_key: string
	tier: number | string | null
}

function isEligible(def: BadgeDef): boolean {
	return def.key !== "community" && def.category !== "tier"
}

function isBetter(aDef: BadgeDef, aTier: number, bDef: BadgeDef, bTier: number): boolean {
	const aCategory = CATEGORY_ORDER.indexOf(aDef.category)
	const bCategory = CATEGORY_ORDER.indexOf(bDef.category)
	if (aCategory !== bCategory) return aCategory < bCategory
	if (aTier !== bTier) return aTier > bTier
	return aDef.key < bDef.key
}

function pickTopBadge(rows: AwardRow[]): BadgeRef | null {
	let best: { def: BadgeDef; sortTier: number; awardTier: number | null } | null = null
	for (const row of rows) {
		const def = DEF_BY_KEY.get(row.badge_key)
		if (!def || !isEligible(def)) continue
		const awardTier = row.tier == null ? null : Number(row.tier)
		const sortTier = awardTier ?? 0
		if (best === null || isBetter(def, sortTier, best.def, best.sortTier)) {
			best = { def, sortTier, awardTier }
		}
	}
	if (!best) return null
	return { key: best.def.key, name: best.def.name, tier: best.awardTier ?? undefined }
}

export async function getBadgeSummaries(
	env: Env,
	userIds: number[]
): Promise<Map<number, BadgeSummary>> {
	const summaries = new Map<number, BadgeSummary>()
	if (userIds.length === 0) return summaries

	const placeholders = userIds.map(() => "?").join(", ")
	const { results } = await env.DB.prepare(
		`SELECT user_id, badge_key, tier FROM badge_awards WHERE user_id IN (${placeholders})`
	)
		.bind(...userIds)
		.all<AwardRow>()

	const byUser = new Map<number, AwardRow[]>()
	for (const row of results) {
		const id = Number(row.user_id)
		const list = byUser.get(id)
		if (list) list.push(row)
		else byUser.set(id, [row])
	}

	for (const [id, rows] of byUser) {
		summaries.set(id, { badgeCount: rows.length, topBadge: pickTopBadge(rows) })
	}
	return summaries
}
