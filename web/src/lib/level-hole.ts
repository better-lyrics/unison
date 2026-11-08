import type { CSSProperties } from "react"

export interface LevelHoleGeometry {
  box: number
  pillHeight: number
  pillWidth: { narrow: number; wide: number }
  offset: number
  gap: number
}

export const PROFILE_LEVEL_HOLE: LevelHoleGeometry = {
  box: 100,
  pillHeight: 22,
  pillWidth: { narrow: 22, wide: 30 },
  offset: 2,
  gap: 4,
}

export const SONG_LEVEL_HOLE: LevelHoleGeometry = {
  box: 52,
  pillHeight: 20,
  pillWidth: { narrow: 20, wide: 28 },
  offset: -3,
  gap: 3,
}

export function levelHoleMask(geometry: LevelHoleGeometry, level: number): string {
  const { box, pillHeight, offset, gap } = geometry
  const pillWidth = level < 10 ? geometry.pillWidth.narrow : geometry.pillWidth.wide
  const width = pillWidth + 2 * gap
  const height = pillHeight + 2 * gap
  const x = box - offset - pillWidth - gap
  const y = box - offset - pillHeight - gap
  const r = height / 2
  const straight = width - 2 * r
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}" preserveAspectRatio="none"><path fill-rule="evenodd" d="M0 0H${box}V${box}H0Z M${x + r} ${y}h${straight}a${r} ${r} 0 0 1 0 ${height}h-${straight}a${r} ${r} 0 0 1 0-${height}Z"/></svg>`
  return `url('data:image/svg+xml,${encodeURIComponent(svg)}')`
}

export function levelHoleStyle(geometry: LevelHoleGeometry, level: number): CSSProperties {
  const mask = levelHoleMask(geometry, level)
  return { maskImage: mask, WebkitMaskImage: mask, maskSize: "100% 100%", WebkitMaskSize: "100% 100%" }
}
