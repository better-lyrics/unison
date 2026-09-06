import { describe, expect, it } from "vitest"
import { groupBadgesByCategory, isRareBadge, resolveBadgeImage } from "./badge-view"
import type { BadgeDef } from "./types"

function def(key: string, category: string, extra: Partial<BadgeDef> = {}): BadgeDef {
  return {
    key,
    name: key,
    description: key,
    category,
    kind: "medal",
    image: { color: `/badges/${key}/image.svg?variant=color`, mono: `/badges/${key}/image.svg?variant=mono` },
    ...extra,
  }
}

const tiered = def("sharp-ear", "curation", {
  tiers: [
    { level: 1, threshold: 10, image: { color: "/t1-color", mono: "/mono" } },
    { level: 2, threshold: 25, image: { color: "/t2-color", mono: "/mono" } },
    { level: 3, threshold: 50 },
  ],
})

describe("groupBadgesByCategory", () => {
  it("groups badges in the given category order", () => {
    const badges = [def("a", "output"), def("b", "tier"), def("c", "output"), def("d", "special")]
    const groups = groupBadgesByCategory(badges, ["tier", "output", "special"])
    expect(groups.map((g) => g.category)).toEqual(["tier", "output", "special"])
    expect(groups[1].badges.map((b) => b.key)).toEqual(["a", "c"])
  })

  it("drops categories in the order list that have no badges", () => {
    const badges = [def("a", "output")]
    const groups = groupBadgesByCategory(badges, ["tier", "output", "special"])
    expect(groups.map((g) => g.category)).toEqual(["output"])
  })
})

describe("resolveBadgeImage", () => {
  it("returns the base image for a non-tiered badge", () => {
    expect(resolveBadgeImage(def("most-loved", "acclaim"), undefined, "color")).toBe(
      "/badges/most-loved/image.svg?variant=color",
    )
  })

  it("returns the tier image for a tiered badge at a level", () => {
    expect(resolveBadgeImage(tiered, 2, "color")).toBe("/t2-color")
  })

  it("returns the mono variant when asked", () => {
    expect(resolveBadgeImage(tiered, 1, "mono")).toBe("/mono")
  })

  describe("edge cases", () => {
    it("falls back to the base image when the tier has no image", () => {
      expect(resolveBadgeImage(tiered, 3, "color")).toBe("/badges/sharp-ear/image.svg?variant=color")
    })

    it("falls back to the base image for an out-of-range tier", () => {
      expect(resolveBadgeImage(tiered, 9, "color")).toBe("/badges/sharp-ear/image.svg?variant=color")
    })

    it("falls back to the base image when a tier is passed to a non-tiered badge", () => {
      expect(resolveBadgeImage(def("committee", "special"), 2, "color")).toBe(
        "/badges/committee/image.svg?variant=color",
      )
    })
  })
})

describe("isRareBadge", () => {
  it("is rare when rarity is below the threshold", () => {
    expect(isRareBadge(def("x", "acclaim", { rarity: 0.04 }), 0.1)).toBe(true)
  })

  it("is not rare when rarity is at or above the threshold", () => {
    expect(isRareBadge(def("x", "acclaim", { rarity: 0.1 }), 0.1)).toBe(false)
    expect(isRareBadge(def("x", "acclaim", { rarity: 0.5 }), 0.1)).toBe(false)
  })

  it("is not rare when rarity is undefined", () => {
    expect(isRareBadge(def("x", "acclaim"), 0.1)).toBe(false)
  })
})

describe("invariants", () => {
  it("preserves every badge exactly once across groups", () => {
    const badges = [def("a", "output"), def("b", "tier"), def("c", "mystery"), def("d", "output")]
    const groups = groupBadgesByCategory(badges, ["tier", "output"])
    const flattened = groups.flatMap((g) => g.badges.map((b) => b.key))
    expect(flattened.sort()).toEqual(["a", "b", "c", "d"])
  })

  it("appends categories missing from the order list after the ordered ones", () => {
    const badges = [def("a", "output"), def("c", "mystery")]
    const groups = groupBadgesByCategory(badges, ["tier", "output"])
    expect(groups.map((g) => g.category)).toEqual(["output", "mystery"])
  })
})
