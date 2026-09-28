export interface BoostQuotaConfig {
	base: number
	inactive: number
	max: number
	upvotedLyricsPerSeal: number
}

export function quotaForBasis(
	basis: { active: boolean; upvotedLyrics: number },
	cfg: BoostQuotaConfig
): { quota: number; bonus: number } {
	if (!basis.active) return { quota: cfg.inactive, bonus: 0 }
	const bonus = Math.min(
		cfg.max - cfg.base,
		Math.floor(basis.upvotedLyrics / cfg.upvotedLyricsPerSeal)
	)
	return { quota: cfg.base + bonus, bonus }
}
