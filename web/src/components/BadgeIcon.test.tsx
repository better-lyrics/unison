import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { BadgeDef } from "@/lib/types"
import { BadgeIcon } from "./BadgeIcon"

afterEach(() => cleanup())

const nonTiered: BadgeDef = {
  key: "most-loved",
  name: "Most Loved",
  description: "desc",
  category: "acclaim",
  kind: "medal",
  image: { color: "/badges/most-loved/image.svg?variant=color", mono: "/badges/most-loved/image.svg?variant=mono" },
}

const tieredBadge: BadgeDef = {
  key: "sharp-ear",
  name: "Sharp Ear",
  description: "desc",
  category: "curation",
  kind: "medal",
  tiers: [
    { level: 1, threshold: 10, image: { color: "/sharp-ear/t1/color", mono: "/sharp-ear/mono" } },
    { level: 2, threshold: 25, image: { color: "/sharp-ear/t2/color", mono: "/sharp-ear/mono" } },
    { level: 3, threshold: 50 },
  ],
  image: { color: "/badges/sharp-ear/image.svg?variant=color", mono: "/badges/sharp-ear/image.svg?variant=mono" },
}

function img(container: HTMLElement): HTMLImageElement {
  const el = container.querySelector("img")
  if (!el) throw new Error("no img rendered")
  return el
}

describe("BadgeIcon", () => {
  it("uses the base image for a non-tiered badge", () => {
    const { container } = render(<BadgeIcon badge={nonTiered} />)
    expect(img(container).getAttribute("src")).toBe("/badges/most-loved/image.svg?variant=color")
  })

  it("uses the tier image for a tiered badge at the given tier", () => {
    const { container } = render(<BadgeIcon badge={tieredBadge} tier={2} />)
    expect(img(container).getAttribute("src")).toBe("/sharp-ear/t2/color")
  })

  it("renders the mono variant when asked", () => {
    const { container } = render(<BadgeIcon badge={nonTiered} variant="mono" />)
    expect(img(container).getAttribute("src")).toBe("/badges/most-loved/image.svg?variant=mono")
  })

  it("sets alt to the badge name", () => {
    const { container } = render(<BadgeIcon badge={nonTiered} />)
    expect(img(container).getAttribute("alt")).toBe("Most Loved")
  })

  it("dims the element when not earned", () => {
    const { container } = render(<BadgeIcon badge={nonTiered} earned={false} />)
    expect(img(container).className).toContain("opacity-30")
  })

  it("does not dim when earned", () => {
    const { container } = render(<BadgeIcon badge={nonTiered} earned />)
    expect(img(container).className).not.toContain("opacity-30")
  })

  describe("edge cases", () => {
    it("falls back to the base image when the tier lacks its own image", () => {
      const { container } = render(<BadgeIcon badge={tieredBadge} tier={3} />)
      expect(img(container).getAttribute("src")).toBe("/badges/sharp-ear/image.svg?variant=color")
    })

    it("falls back to the base image when a tier is passed to a non-tiered badge", () => {
      const { container } = render(<BadgeIcon badge={nonTiered} tier={2} />)
      expect(img(container).getAttribute("src")).toBe("/badges/most-loved/image.svg?variant=color")
    })
  })
})
