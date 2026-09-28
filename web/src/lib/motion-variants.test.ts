import { describe, expect, it } from "vitest"
import {
  iconSwapVariants,
  labelSwapVariants,
  sealStamp,
  staggerDelay,
  thudFrom,
  thudTransition,
} from "./motion-variants"

describe("motion-variants", () => {
  it("blurs the icon on entry and exit and clears it while visible", () => {
    expect(iconSwapVariants.initial).toMatchObject({ filter: "blur(2px)" })
    expect(iconSwapVariants.exit).toMatchObject({ filter: "blur(2px)" })
    expect(iconSwapVariants.animate).toMatchObject({ filter: "blur(0px)" })
  })

  it("blurs the label on entry and exit and clears it while visible", () => {
    expect(labelSwapVariants.initial).toMatchObject({ filter: "blur(2px)" })
    expect(labelSwapVariants.exit).toMatchObject({ filter: "blur(2px)" })
    expect(labelSwapVariants.animate).toMatchObject({ filter: "blur(0px)" })
  })

  it("swaps the label vertically in opposite directions on entry and exit", () => {
    expect(labelSwapVariants.initial).toMatchObject({ y: 4 })
    expect(labelSwapVariants.exit).toMatchObject({ y: -4 })
    expect(labelSwapVariants.animate).toMatchObject({ y: 0 })
  })
})

describe("thud", () => {
  it("lands from the given scale through a dip and a small overshoot to rest", () => {
    expect(thudFrom(2.6)).toEqual({
      initial: { scale: 2.6, opacity: 0 },
      animate: { scale: [2.6, 0.9, 1.04, 1], opacity: [0, 1, 1, 1] },
    })
  })

  it("scales the dip and overshoot with the depth for a gentler landing", () => {
    expect(thudFrom(1.08, 0.03).animate.scale).toEqual([1.08, 0.97, 1.012, 1])
  })

  it("always rests at scale 1 and full opacity", () => {
    for (const [scale, depth] of [
      [2.6, 0.1],
      [1.08, 0.03],
      [1, 0],
    ]) {
      const { animate } = thudFrom(scale, depth)
      expect(animate.scale.at(-1)).toBe(1)
      expect(animate.opacity.at(-1)).toBe(1)
    }
  })

  it("keeps one timing entry per keyframe", () => {
    const transition = thudTransition(0.2)
    expect(transition.times).toHaveLength(thudFrom(2).animate.scale.length)
    expect(transition.delay).toBe(0.2)
    expect(transition.duration).toBe(0.34)
  })
})

describe("sealStamp", () => {
  it("spins the seal in from -40 degrees to its resting tilt", () => {
    const stamp = sealStamp(0.5)
    expect(stamp.initial).toEqual({ rotate: -40, scale: 0.4, opacity: 0 })
    expect(stamp.animate).toEqual({ rotate: -6, scale: 1, opacity: 1 })
    expect(stamp.transition).toMatchObject({ delay: 0.5, duration: 0.38 })
  })
})

describe("staggerDelay", () => {
  it("steps 40ms per index", () => {
    expect(staggerDelay(0)).toBe(0)
    expect(staggerDelay(3)).toBeCloseTo(0.12)
  })

  it("caps the wait so late items never lag far behind", () => {
    expect(staggerDelay(12)).toBeCloseTo(staggerDelay(500))
  })

  it("treats a negative index as the first item", () => {
    expect(staggerDelay(-3)).toBe(0)
  })
})
