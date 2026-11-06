import { describe, expect, it } from "vitest"
import { levelHoleMask, PROFILE_LEVEL_HOLE } from "./level-hole"

const holeLength = (level: number) => {
  const svg = decodeURIComponent(levelHoleMask(PROFILE_LEVEL_HOLE, level).slice("url('data:image/svg+xml,".length, -2))
  const straight = svg.match(/h([\d.]+)a/)
  if (!straight) throw new Error(`no hole in ${svg}`)
  return Number(straight[1])
}

describe("levelHoleMask", () => {
  it("widens the hole for two-digit levels", () => {
    expect(holeLength(12)).toBeGreaterThan(holeLength(4))
  })
})
