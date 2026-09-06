import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { BadgeCatalogue, BadgeDef, UserGamification } from "@/lib/types"
import { BadgeWall } from "./BadgeWall"

function def(key: string, category: string, extra: Partial<BadgeDef> = {}): BadgeDef {
  return {
    key,
    name: key,
    description: `${key} desc`,
    category,
    kind: "medal",
    image: { color: `/badge-art/${key}.svg`, mono: `/badge-art/${key}_mono.svg` },
    ...extra,
  }
}

function catalogueFrom(badges: BadgeDef[], overrides: Partial<BadgeCatalogue["display"]> = {}): BadgeCatalogue {
  return {
    badges,
    display: {
      inlineGlyphs: 1,
      featuredMax: 5,
      rarityThreshold: 0.1,
      categoryOrder: ["tier", "output", "coverage", "curation", "acclaim", "special"],
      ...overrides,
    },
  }
}

function gam(overrides: Partial<UserGamification> = {}): UserGamification {
  return {
    keyId: "u".repeat(64),
    level: 5,
    xp: 700,
    xpForNext: 1200,
    tier: "elite",
    tierRank: 4,
    featured: [],
    badges: [],
    counts: { earned: 0, total: 0 },
    ...overrides,
  }
}

afterEach(() => cleanup())

describe("BadgeWall", () => {
  it("renders the Badges heading and unlocked count", () => {
    render(
      <BadgeWall
        gamification={gam({ counts: { earned: 3, total: 8 } })}
        catalogue={catalogueFrom([def("a", "output")])}
      />,
    )
    expect(screen.getByRole("heading", { level: 2, name: "Badges" })).toBeTruthy()
    expect(screen.getByText(/of 8 unlocked/)).toBeTruthy()
  })

  it("groups badges by the display category order, unlisted categories last", () => {
    const catalogue = catalogueFrom([def("a", "special"), def("b", "tier"), def("c", "mystery"), def("d", "special")], {
      categoryOrder: ["tier", "special"],
    })
    render(<BadgeWall gamification={gam()} catalogue={catalogue} />)
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(["Tier", "Special", "Mystery"])
  })

  it("shows a locked badge dimmed with its progress", () => {
    const catalogue = catalogueFrom([def("polyglot", "coverage")])
    const gamification = gam({
      badges: [{ key: "polyglot", earned: false, progress: { current: 2, next: 3 }, featured: false }],
    })
    render(<BadgeWall gamification={gamification} catalogue={catalogue} />)
    expect(document.querySelector('[data-earned="false"]')).not.toBeNull()
    expect(screen.getByText("2 / 3")).toBeTruthy()
  })

  it("marks earned badges as earned", () => {
    const catalogue = catalogueFrom([def("most-loved", "acclaim")])
    const gamification = gam({ badges: [{ key: "most-loved", earned: true, featured: false }] })
    render(<BadgeWall gamification={gamification} catalogue={catalogue} />)
    expect(document.querySelector('[data-earned="true"]')).not.toBeNull()
  })

  it("shows the rarity label only for badges below the rarity threshold", () => {
    const catalogue = catalogueFrom([
      def("rare-one", "acclaim", { rarity: 0.04 }),
      def("common-one", "acclaim", { rarity: 0.5 }),
      def("no-rarity", "acclaim"),
    ])
    render(<BadgeWall gamification={gam()} catalogue={catalogue} />)
    expect(screen.getAllByText("Rare")).toHaveLength(1)
  })

  it("shows the tier rank on the user's current tier badge", () => {
    const catalogue = catalogueFrom([def("legendary", "tier", { kind: "title" })])
    const gamification = gam({
      tier: "legendary",
      tierRank: 1,
      badges: [{ key: "legendary", earned: true, featured: false }],
    })
    render(<BadgeWall gamification={gamification} catalogue={catalogue} />)
    expect(screen.getByText("Rank #1")).toBeTruthy()
  })

  describe("edge cases", () => {
    it("renders an all-locked wall for a user with zero earned badges", () => {
      const catalogue = catalogueFrom([def("a", "output"), def("b", "coverage")])
      render(<BadgeWall gamification={gam({ counts: { earned: 0, total: 2 } })} catalogue={catalogue} />)
      expect(document.querySelectorAll('[data-earned="false"]')).toHaveLength(2)
      expect(document.querySelector('[data-earned="true"]')).toBeNull()
    })

    it("hides a locked secret badge but shows an earned one", () => {
      const catalogue = catalogueFrom([
        def("hidden-secret", "special", { secret: true }),
        def("shown-secret", "special", { secret: true }),
      ])
      const gamification = gam({ badges: [{ key: "shown-secret", earned: true, featured: false }] })
      render(<BadgeWall gamification={gamification} catalogue={catalogue} />)
      expect(screen.getAllByText("shown-secret").length).toBeGreaterThan(0)
      expect(screen.queryByText("hidden-secret")).toBeNull()
    })
  })
})
