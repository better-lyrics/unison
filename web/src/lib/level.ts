export interface LevelProgress {
  pct: number
  remaining: number
  atMax: boolean
}

export function levelProgress(xp: number, xpForNext: number | null, xpFloor = 0): LevelProgress {
  if (xpForNext === null || xpForNext <= xpFloor) {
    return { pct: 1, remaining: 0, atMax: true }
  }
  const pct = Math.min(1, Math.max(0, (xp - xpFloor) / (xpForNext - xpFloor)))
  const remaining = Math.max(0, xpForNext - xp)
  return { pct, remaining, atMax: false }
}
