import { describe, expect, it } from "vitest"
import * as server from "../../../src/utils/accent"
import { accentFromPixels, FALLBACK_HUE, inks, scrimFor } from "./accent"

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

describe("accent parity with the server", () => {
  const mixed = () => {
    const px = new Uint8ClampedArray(32 * 32 * 4)
    for (let i = 0; i < px.length; i += 4) {
      const n = i / 4
      px.set([(n * 37) % 256, (n * 91) % 256, (n * 13) % 256, n % 7 === 0 ? 0 : 255], i)
    }
    return px
  }

  it("samples the same accent, scrim and inks on the web and the server", () => {
    for (const px of [solid(40, 90, 220), solid(128, 128, 128), solid(250, 240, 200), mixed()]) {
      const accent = accentFromPixels(px)
      expect(server.accentFromPixels(px)).toEqual(accent)
      expect(server.scrimFor(accent.lum)).toBe(scrimFor(accent.lum))
      expect(server.inks(accent.hue)).toEqual(inks(accent.hue))
    }
    expect(server.FALLBACK_HUE).toBe(FALLBACK_HUE)
    expect(server.accentHex(0)).toBe("#d92626")
  })
})
