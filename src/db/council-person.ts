import { type BadgeSummary, getBadgeSummaries } from "@/db/badge-summary"
import { getCuratorTierMap } from "@/db/leaderboard"
import type { Person } from "@/db/users"
import type { Env } from "@/types"
import type { TierName } from "@/utils/tiers"

export interface CouncilPerson extends Person, BadgeSummary {
	tier: TierName | null
}

export interface PersonDecor {
	tiers: Map<string, TierName | null>
	badges: Map<number, BadgeSummary>
}

export async function loadPersonDecor(env: Env, people: Person[]): Promise<PersonDecor> {
	const [tiers, badges] = await Promise.all([
		getCuratorTierMap(env),
		getBadgeSummaries(env, [...new Set(people.map((p) => p.userId))]),
	])
	return { tiers, badges }
}

export function toCouncilPerson(person: Person, decor: PersonDecor): CouncilPerson {
	const badges = decor.badges.get(person.userId)
	return {
		...person,
		tier: decor.tiers.get(person.keyId) ?? null,
		badgeCount: badges?.badgeCount ?? 0,
		topBadge: badges?.topBadge ?? null,
		featured: badges?.featured ?? [],
	}
}
