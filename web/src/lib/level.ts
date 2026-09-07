export interface LevelProgress {
  pct: number
  remaining: number
  atMax: boolean
}

// Backend exposes xp and xpForNext but not the level floor, so the ring uses xp/xpForNext.
export function levelProgress(xp: number, xpForNext: number | null): LevelProgress {
  if (xpForNext === null || xpForNext <= 0) {
    return { pct: 1, remaining: 0, atMax: true }
  }
  const pct = Math.min(1, Math.max(0, xp / xpForNext))
  const remaining = Math.max(0, xpForNext - xp)
  return { pct, remaining, atMax: false }
}
