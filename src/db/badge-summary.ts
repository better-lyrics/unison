import { config } from "@/config"
import { type BadgeDef, CATALOGUE } from "@/db/badges/definitions"
import type { BadgeRef, Env } from "@/types"

const DEF_BY_KEY = new Map<string, BadgeDef>(CATALOGUE.map((def) => [def.key, def]))
const CATEGORY_ORDER = config.gamification.display.categoryOrder
const FEATURED_MAX = config.gamification.featured.maxSlots

export interface BadgeSummary {
	badgeCount: number
	topBadge: BadgeRef | null
	featured: BadgeRef[]
}

interface AwardRow {
	user_id: number | string
	badge_key: string
	tier: number | string | null
}

function isEligible(def: BadgeDef): boolean {
	return def.category !== "tier"
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

function parseFeaturedKeys(raw: string | null): string[] {
	if (!raw) return []
	try {
		const parsed = JSON.parse(raw)
		return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : []
	} catch {
		return []
	}
}

function resolveFeatured(keys: string[], tierByKey: Map<string, number | null>): BadgeRef[] {
	const featured: BadgeRef[] = []
	for (const key of keys.slice(0, FEATURED_MAX)) {
		const def = DEF_BY_KEY.get(key)
		if (!def) continue
		const tier = tierByKey.get(key)
		featured.push({ key: def.key, name: def.name, tier: tier == null ? undefined : tier })
	}
	return featured
}

// When a user has not chosen a featured set, showcase their strongest earned medals by the same
// ranking topBadge uses (category order, then tier, then key), capped at the featured slot count.
export function defaultFeaturedKeys(awards: { key: string; tier: number | null }[]): string[] {
	const eligible = awards
		.map((award) => ({ def: DEF_BY_KEY.get(award.key), tier: award.tier }))
		.filter((entry): entry is { def: BadgeDef; tier: number | null } => {
			return entry.def !== undefined && isEligible(entry.def)
		})
	eligible.sort((a, b) => {
		if (isBetter(a.def, a.tier ?? 0, b.def, b.tier ?? 0)) return -1
		if (isBetter(b.def, b.tier ?? 0, a.def, a.tier ?? 0)) return 1
		return 0
	})
	return eligible.slice(0, FEATURED_MAX).map((entry) => entry.def.key)
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

	const featuredRows = await env.DB.prepare(
		`SELECT id, featured_badges FROM users WHERE id IN (${placeholders})`
	)
		.bind(...userIds)
		.all<{ id: number | string; featured_badges: string | null }>()
	const featuredByUser = new Map<number, string[]>()
	for (const row of featuredRows.results) {
		featuredByUser.set(Number(row.id), parseFeaturedKeys(row.featured_badges))
	}

	for (const [id, rows] of byUser) {
		const tierByKey = new Map<string, number | null>()
		for (const r of rows) tierByKey.set(r.badge_key, r.tier == null ? null : Number(r.tier))
		const stored = featuredByUser.get(id) ?? []
		const keys =
			stored.length > 0
				? stored
				: defaultFeaturedKeys(
						rows.map((r) => ({ key: r.badge_key, tier: r.tier == null ? null : Number(r.tier) }))
					)
		const featured = resolveFeatured(keys, tierByKey)
		summaries.set(id, { badgeCount: rows.length, topBadge: pickTopBadge(rows), featured })
	}
	return summaries
}
