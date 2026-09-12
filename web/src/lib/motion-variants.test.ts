import { describe, expect, it } from "vitest"
import { iconSwapVariants, labelSwapVariants } from "./motion-variants"

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
