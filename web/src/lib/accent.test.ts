import { describe, expect, it } from "vitest"
import { accentFromPixels, FALLBACK_HUE } from "./accent"

const solid = (r: number, g: number, b: number, a = 255) => {
  const px = new Uint8ClampedArray(32 * 32 * 4)
  for (let i = 0; i < px.length; i += 4) px.set([r, g, b, a], i)
  return px
}

describe("accentFromPixels", () => {
  it("takes the hue of saturated art", () => {
    expect(accentFromPixels(solid(40, 90, 220)).hue).toBeGreaterThan(210)
    expect(accentFromPixels(solid(40, 90, 220)).hue).toBeLessThan(235)
  })

  it("falls back to the default hue for grey art instead of a random one", () => {
    expect(accentFromPixels(solid(128, 128, 128)).hue).toBe(FALLBACK_HUE)
  })

  it("reports the transparent share so a cutout avatar gets a backing", () => {
    expect(accentFromPixels(solid(0, 0, 0, 0)).clear).toBe(1)
  })
})
