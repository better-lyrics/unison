import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { clearAsyncDataCache } from "@/hooks/useAsyncData"
import type { BadgeCatalogue, BadgeDef, UserGamification } from "@/lib/types"
import { BadgeCatalogueProvider } from "./BadgeCatalogueContext"
import { BadgeWall } from "./BadgeWall"

function def(key: string, category: string, extra: Partial<BadgeDef> = {}): BadgeDef {
  return {
    key,
    name: key,
    description: `${key} desc`,
    category,
    kind: "medal",
    image: { color: `/badges/${key}/color`, mono: `/badges/${key}/mono` },
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

function renderWall(catalogue: BadgeCatalogue, gamification: UserGamification) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url === "/badges") {
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: catalogue }), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected url ${url}`))
    }),
  )
  return render(
    <BadgeCatalogueProvider>
      <BadgeWall gamification={gamification} />
    </BadgeCatalogueProvider>,
  )
}

beforeEach(() => {
  clearAsyncDataCache()
  vi.unstubAllGlobals()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  clearAsyncDataCache()
})

describe("BadgeWall", () => {
  it("renders the header with tier and level", async () => {
    renderWall(catalogueFrom([def("most-loved", "acclaim")]), gam({ level: 8, tier: "legendary", tierRank: 1 }))
    await waitFor(() => expect(screen.getByText("Level 8")).toBeTruthy())
    expect(screen.getByText("Legendary")).toBeTruthy()
  })

  it("groups badges by the display category order, unlisted categories last", async () => {
    const catalogue = catalogueFrom([def("a", "special"), def("b", "tier"), def("c", "mystery"), def("d", "special")], {
      categoryOrder: ["tier", "special"],
    })
    renderWall(catalogue, gam())
    await waitFor(() => expect(screen.getByText("Tier")).toBeTruthy())
    const headings = screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent)
    expect(headings).toEqual(["Tier", "Special", "Mystery"])
  })

  it("shows a locked badge dimmed with its progress", async () => {
    const catalogue = catalogueFrom([def("polyglot", "coverage")])
    const gamification = gam({
      badges: [{ key: "polyglot", earned: false, progress: { current: 2, next: 3 }, featured: false }],
    })
    renderWall(catalogue, gamification)
    await waitFor(() => expect(screen.getByText("polyglot")).toBeTruthy())
    const tile = document.querySelector('[data-earned="false"]')
    expect(tile).not.toBeNull()
    expect(screen.getByText("2 / 3")).toBeTruthy()
  })

  it("marks earned badges as earned", async () => {
    const catalogue = catalogueFrom([def("most-loved", "acclaim")])
    const gamification = gam({ badges: [{ key: "most-loved", earned: true, featured: false }] })
    renderWall(catalogue, gamification)
    await waitFor(() => expect(screen.getByText("most-loved")).toBeTruthy())
    expect(document.querySelector('[data-earned="true"]')).not.toBeNull()
  })

  it("shows the rarity label only for badges below the rarity threshold", async () => {
    const catalogue = catalogueFrom([
      def("rare-one", "acclaim", { rarity: 0.04 }),
      def("common-one", "acclaim", { rarity: 0.5 }),
      def("no-rarity", "acclaim"),
    ])
    renderWall(catalogue, gam())
    await waitFor(() => expect(screen.getByText("rare-one")).toBeTruthy())
    expect(screen.getAllByText("Rare")).toHaveLength(1)
  })

  it("caps the showcase at featuredMax", async () => {
    const keys = ["b1", "b2", "b3", "b4", "b5", "b6", "b7"]
    const catalogue = catalogueFrom(
      keys.map((k) => def(k, "output")),
      { featuredMax: 5 },
    )
    const gamification = gam({
      featured: keys,
      badges: keys.map((k) => ({ key: k, earned: true, featured: true })),
    })
    renderWall(catalogue, gamification)
    await waitFor(() => expect(screen.getByText("Featured")).toBeTruthy())
    const showcase = screen.getByTestId("badge-showcase")
    expect(within(showcase).getAllByRole("img")).toHaveLength(5)
  })

  it("renders the top expertise strip", async () => {
    const catalogue = catalogueFrom([def("most-loved", "acclaim")])
    const gamification = gam({
      topExpertise: [
        { scope: "artist", name: "Radiohead", rank: 2 },
        { scope: "language", name: "Japanese", rank: 5 },
      ],
    })
    renderWall(catalogue, gamification)
    await waitFor(() => expect(screen.getByText("Top expertise")).toBeTruthy())
    expect(screen.getByText("Radiohead")).toBeTruthy()
    expect(screen.getByText("Japanese")).toBeTruthy()
    expect(screen.getByText("#2")).toBeTruthy()
    expect(screen.getByText("#5")).toBeTruthy()
  })

  describe("edge cases", () => {
    it("renders an all-locked wall for a user with zero earned badges", async () => {
      const catalogue = catalogueFrom([def("a", "output"), def("b", "coverage")])
      renderWall(catalogue, gam({ badges: [], featured: [], counts: { earned: 0, total: 2 } }))
      await waitFor(() => expect(screen.getByText("Badges")).toBeTruthy())
      expect(screen.queryByText("Featured")).toBeNull()
      expect(document.querySelectorAll('[data-earned="false"]')).toHaveLength(2)
      expect(document.querySelector('[data-earned="true"]')).toBeNull()
    })

    it("renders without a tier chip when the user has no tier", async () => {
      renderWall(catalogueFrom([def("a", "output")]), gam({ tier: null, tierRank: null }))
      await waitFor(() => expect(screen.getByText("Level 5")).toBeTruthy())
      expect(screen.queryByText("Elite")).toBeNull()
    })

    it("shows a max-level label when there is no next level", async () => {
      renderWall(catalogueFrom([def("a", "output")]), gam({ xp: 4000, xpForNext: null }))
      await waitFor(() => expect(screen.getByText(/max level/i)).toBeTruthy())
    })

    it("hides a locked secret badge but shows an earned one", async () => {
      const catalogue = catalogueFrom([
        def("hidden-secret", "special", { secret: true }),
        def("shown-secret", "special", { secret: true }),
      ])
      const gamification = gam({ badges: [{ key: "shown-secret", earned: true, featured: false }] })
      renderWall(catalogue, gamification)
      await waitFor(() => expect(screen.getByText("shown-secret")).toBeTruthy())
      expect(screen.queryByText("hidden-secret")).toBeNull()
    })
  })
})
