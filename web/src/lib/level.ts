export interface LevelProgress {
  pct: number
  remaining: number
  atMax: boolean
}

// The backend hands us cumulative xp plus xpForNext (the xp threshold of the next level, or
// null at max). It does not expose the current level's floor, so the ring uses xp/xpForNext
// (the finalised design's choice); the remaining figure is exact.
export function levelProgress(xp: number, xpForNext: number | null): LevelProgress {
  if (xpForNext === null || xpForNext <= 0) {
    return { pct: 1, remaining: 0, atMax: true }
  }
  const pct = Math.min(1, Math.max(0, xp / xpForNext))
  const remaining = Math.max(0, xpForNext - xp)
  return { pct, remaining, atMax: false }
}
