import { config } from "@/config"
import { BADGES } from "@/db/badges/definitions"
import { DERIVATIONS } from "@/db/badges/derivation"
import { getXp } from "@/db/contribution-events"
import { getCuratorRank } from "@/db/leaderboard"
import type { Env } from "@/types"
import { isLinkBlacklisted } from "@/utils/blacklist"
import type { TierName } from "@/utils/tiers"
import { levelForXp } from "@/utils/xp"

export interface AwardedBadge {
	key: string
	tier?: number
}

export interface UserBadge {
	key: string
	earned: boolean
	earnedAt?: number
	tier?: number
	progress?: { current: number; next: number | null }
	featured: boolean
}

export interface ExpertiseEntry {
	scope: "artist" | "language"
	name: string
	rank: number
}

export interface UserGamification {
	keyId: string
	level: number
	xp: number
	xpForNext: number | null
	tier: TierName | null
	tierRank: number | null
	badges: UserBadge[]
	featured: string[]
	counts: { earned: number; total: number }
	topExpertise?: ExpertiseEntry[]
}

export type SetFeaturedResult =
	| { ok: true; gamification: UserGamification }
	| { ok: false; reason: "unearned" | "over_cap" }

const UPSERT_AWARD = `INSERT INTO badge_awards (user_id, badge_key, tier)
	VALUES (?, ?, ?)
	ON CONFLICT (user_id, badge_key)
	DO UPDATE SET tier = EXCLUDED.tier
	WHERE COALESCE(EXCLUDED.tier, 0) > COALESCE(badge_awards.tier, 0)
	RETURNING id`

const NON_COMMUNITY_KEYS = BADGES.map((b) => b.key).filter(
	(k) => k !== "community" && DERIVATIONS[k] !== undefined
)

function applicableKeys(keyId: string): string[] {
	return isLinkBlacklisted(keyId) ? ["community"] : NON_COMMUNITY_KEYS
}

function higherTier(a: number | null | undefined, b: number | undefined): number | undefined {
	const tiers = [a, b].filter((t): t is number => typeof t === "number")
	return tiers.length > 0 ? Math.max(...tiers) : undefined
}

export async function evaluateAndAward(env: Env, userId: number): Promise<AwardedBadge[]> {
	const user = await env.DB.prepare("SELECT key_id FROM users WHERE id = ?")
		.bind(userId)
		.first<{ key_id: string }>()
	if (!user) return []

	const awarded: AwardedBadge[] = []
	for (const key of applicableKeys(user.key_id)) {
		const evaluation = await DERIVATIONS[key](env, userId)
		if (!evaluation.earned) continue
		const row = await env.DB.prepare(UPSERT_AWARD)
			.bind(userId, key, evaluation.tier ?? null)
			.first<{ id: number }>()
		if (row) awarded.push({ key, tier: evaluation.tier })
	}
	return awarded
}

function parseFeatured(raw: string | null): string[] {
	if (!raw) return []
	try {
		const parsed = JSON.parse(raw)
		if (!Array.isArray(parsed)) return []
		return parsed.filter((k): k is string => typeof k === "string")
	} catch {
		return []
	}
}

async function computeTopExpertise(env: Env, userId: number): Promise<ExpertiseEntry[]> {
	const entries: ExpertiseEntry[] = []

	const topArtist = await env.DB.prepare(
		`SELECT artist, COUNT(*) AS n FROM lyrics
		 WHERE submitter_id = ? AND deleted_at IS NULL AND confidence IN ('medium','high')
		 GROUP BY artist ORDER BY n DESC, artist ASC LIMIT 1`
	)
		.bind(userId)
		.first<{ artist: string; n: string | number }>()
	if (topArtist) {
		const count = Number(topArtist.n)
		const rankRow = await env.DB.prepare(
			`SELECT COUNT(*) + 1 AS rank FROM (
			   SELECT submitter_id, COUNT(*) AS n FROM lyrics
			   WHERE artist = ? AND deleted_at IS NULL AND confidence IN ('medium','high')
			     AND submitter_id IS NOT NULL
			   GROUP BY submitter_id
			 ) t WHERE t.n > ?`
		)
			.bind(topArtist.artist, count)
			.first<{ rank: string | number }>()
		entries.push({ scope: "artist", name: topArtist.artist, rank: Number(rankRow?.rank ?? 1) })
	}

	const topLanguage = await env.DB.prepare(
		`SELECT language, COUNT(*) AS n FROM lyrics
		 WHERE submitter_id = ? AND deleted_at IS NULL AND confidence IN ('medium','high')
		   AND language IS NOT NULL
		 GROUP BY language ORDER BY n DESC, language ASC LIMIT 1`
	)
		.bind(userId)
		.first<{ language: string; n: string | number }>()
	if (topLanguage) {
		const count = Number(topLanguage.n)
		const rankRow = await env.DB.prepare(
			`SELECT COUNT(*) + 1 AS rank FROM (
			   SELECT submitter_id, COUNT(*) AS n FROM lyrics
			   WHERE language = ? AND deleted_at IS NULL AND confidence IN ('medium','high')
			     AND submitter_id IS NOT NULL
			   GROUP BY submitter_id
			 ) t WHERE t.n > ?`
		)
			.bind(topLanguage.language, count)
			.first<{ rank: string | number }>()
		entries.push({
			scope: "language",
			name: topLanguage.language,
			rank: Number(rankRow?.rank ?? 1),
		})
	}

	return entries
}

export async function getUserBadges(env: Env, keyId: string): Promise<UserGamification> {
	const thresholds = config.gamification.xp.levelThresholds

	const user = await env.DB.prepare("SELECT id, featured_badges FROM users WHERE key_id = ?")
		.bind(keyId)
		.first<{ id: number; featured_badges: string | null }>()

	if (!user) {
		const { level, xpForNext } = levelForXp(0, thresholds)
		return {
			keyId,
			level,
			xp: 0,
			xpForNext,
			tier: null,
			tierRank: null,
			badges: [],
			featured: [],
			counts: { earned: 0, total: applicableKeys(keyId).length },
		}
	}

	const userId = user.id
	const xp = await getXp(env, userId)
	const { level, xpForNext } = levelForXp(xp, thresholds)

	const rank = await getCuratorRank(env, keyId)
	const featured = parseFeatured(user.featured_badges)

	const earnedRows = await env.DB.prepare(
		"SELECT badge_key, tier, awarded_at FROM badge_awards WHERE user_id = ?"
	)
		.bind(userId)
		.all<{ badge_key: string; tier: number | null; awarded_at: string | number }>()
	const earnedMap = new Map<string, { tier: number | null; awardedAt: number }>()
	for (const r of earnedRows.results) {
		earnedMap.set(r.badge_key, { tier: r.tier, awardedAt: Number(r.awarded_at) })
	}

	const community = isLinkBlacklisted(keyId)

	const badges: UserBadge[] = []
	for (const key of applicableKeys(keyId)) {
		const evaluation = await DERIVATIONS[key](env, userId)
		const award = earnedMap.get(key)
		const earned = award !== undefined || evaluation.earned
		badges.push({
			key,
			earned,
			earnedAt: award?.awardedAt,
			tier: earned ? higherTier(award?.tier, evaluation.tier) : undefined,
			progress: evaluation.progress,
			featured: earned && featured.includes(key),
		})
	}

	const result: UserGamification = {
		keyId,
		level,
		xp,
		xpForNext,
		tier: rank?.tier ?? null,
		tierRank: rank?.rank ?? null,
		badges,
		featured,
		counts: { earned: badges.filter((b) => b.earned).length, total: badges.length },
	}

	if (!community) {
		const topExpertise = await computeTopExpertise(env, userId)
		if (topExpertise.length > 0) result.topExpertise = topExpertise
	}

	return result
}

export async function setFeatured(
	env: Env,
	userId: number,
	keys: string[]
): Promise<SetFeaturedResult> {
	if (keys.length > config.gamification.featured.maxSlots) {
		return { ok: false, reason: "over_cap" }
	}

	const earnedRows = await env.DB.prepare("SELECT badge_key FROM badge_awards WHERE user_id = ?")
		.bind(userId)
		.all<{ badge_key: string }>()
	const earnedKeys = new Set(earnedRows.results.map((r) => r.badge_key))
	for (const key of keys) {
		if (!earnedKeys.has(key)) return { ok: false, reason: "unearned" }
	}

	await env.DB.prepare("UPDATE users SET featured_badges = ? WHERE id = ?")
		.bind(JSON.stringify(keys), userId)
		.run()

	const user = await env.DB.prepare("SELECT key_id FROM users WHERE id = ?")
		.bind(userId)
		.first<{ key_id: string }>()
	if (!user) throw new Error(`user ${userId} not found`)

	return { ok: true, gamification: await getUserBadges(env, user.key_id) }
}
