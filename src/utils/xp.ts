export interface LevelInfo {
	level: number
	xpForNext: number | null
	xpFloor: number
}

export function levelForXp(xp: number, thresholds: readonly number[]): LevelInfo {
	const reached = thresholds.filter((threshold) => threshold <= xp).length
	const level = Math.max(1, reached)
	const xpForNext = thresholds[level] ?? null
	const xpFloor = thresholds[level - 1] ?? 0
	return { level, xpForNext, xpFloor }
}

export function levelProgress(xp: number, xpForNext: number | null, xpFloor: number): number {
	if (xpForNext === null || xpForNext <= xpFloor) return 1
	return Math.min(1, Math.max(0, (xp - xpFloor) / (xpForNext - xpFloor)))
}
