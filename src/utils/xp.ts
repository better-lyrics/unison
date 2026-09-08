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
