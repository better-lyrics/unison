import type { Person } from "@/db/users"
import type { TierName } from "@/utils/tiers"

export interface CouncilPerson extends Person {
	tier: TierName | null
}

export function withTier(person: Person, tiers: Map<string, TierName | null>): CouncilPerson {
	return { ...person, tier: tiers.get(person.keyId) ?? null }
}
