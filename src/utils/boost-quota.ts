import type { TierName } from "./tiers"

export interface BoostQuotaConfig {
	quotaBase: number
	quotaPerTier: number
}

const LADDER: readonly TierName[] = ["lyricist", "elite", "master", "grandmaster", "legendary"]

export function quotaForTier(tier: TierName | null, cfg: BoostQuotaConfig): number {
	if (tier === null) return cfg.quotaBase
	return cfg.quotaBase + cfg.quotaPerTier * LADDER.indexOf(tier)
}
