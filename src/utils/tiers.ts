export type TierName = "lyricist" | "elite" | "master" | "grandmaster" | "legendary"

export interface TierConfig {
	podium: readonly string[]
	elite: { topPercent: number }
	lyricist: { topPercent: number }
}

export function tierForRank(rank: number, total: number, cfg: TierConfig): TierName | null {
	const index = rank - 1
	const podium = cfg.podium[index]
	if (podium !== undefined) return podium as TierName
	if (index < Math.ceil((total * cfg.elite.topPercent) / 100)) return "elite"
	if (index < Math.ceil((total * cfg.lyricist.topPercent) / 100)) return "lyricist"
	return null
}
