import { FeaturedBadgeEditor } from "@/components/FeaturedBadgeEditor"
import type { BadgeCatalogue, BadgeDef, UserGamification } from "@/lib/types"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MotionGlobalConfig } from "motion/react"
import { afterEach, describe, expect, it, vi } from "vitest"

// Force motion to settle enter/exit instantly so AnimatePresence unmounts removed tiles in the
// same synchronous flush, and give its reduced-motion probe the matchMedia happy-dom omits.
MotionGlobalConfig.skipAnimations = true
if (typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false
    },
  })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function def(key: string, name: string, category: string): BadgeDef {
  return {
    key,
    name,
    description: `${name} description`,
    category,
    kind: "medal",
    image: {
      color: `/badge-art/${key}.svg`,
      mono: `/badge-art/${key}_mono.svg`,
      silhouette: `/badge-art/${key}_silhouette.svg`,
    },
  }
}

function catalogue(featuredMax = 5): BadgeCatalogue {
  return {
    badges: [
      def("most-loved", "Most Loved", "acclaim"),
      def("sharp-ear", "Sharp Ear", "curation"),
      def("trailblazer", "Trailblazer", "coverage"),
      def("polyglot", "Polyglot", "coverage"),
    ],
    display: { inlineGlyphs: 1, featuredMax, rarityThreshold: 0.1, categoryOrder: [] },
  }
}

function gamification(overrides: Partial<UserGamification> = {}): UserGamification {
  return {
    keyId: "a".repeat(64),
    level: 5,
    xp: 100,
    xpForNext: 200,
    xpFloor: 50,
    tier: null,
    tierRank: null,
    featured: [],
    counts: { earned: 3, total: 4 },
    badges: [
      { key: "most-loved", earned: true, featured: false },
      { key: "sharp-ear", earned: true, featured: false },
      { key: "trailblazer", earned: true, featured: false },
      { key: "polyglot", earned: false, progress: { current: 2, next: 3 }, featured: false },
    ],
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// The add grid renders each candidate as a plain button whose accessible name is the badge name.
function addTile(name: string): HTMLElement {
  return screen.getByRole("button", { name })
}
function unfeatureButton(name: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`unfeature ${name}`, "i") })
}
function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: "Save" })
}

describe("FeaturedBadgeEditor", () => {
  it("puts featured badges in the strip and only unfeatured earned badges in the add grid", () => {
    render(
      <FeaturedBadgeEditor
        gamification={gamification({ featured: ["most-loved"] })}
        catalogue={catalogue()}
        onSaved={vi.fn()}
      />,
    )
    // Featured -> strip (unfeature affordance), not a plain add button.
    expect(unfeatureButton("Most Loved")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Most Loved" })).toBeNull()
    // Unfeatured earned -> add grid.
    expect(addTile("Sharp Ear")).toBeTruthy()
    expect(addTile("Trailblazer")).toBeTruthy()
  })

  it("does not offer locked badges anywhere", () => {
    render(<FeaturedBadgeEditor gamification={gamification()} catalogue={catalogue()} onSaved={vi.fn()} />)
    expect(screen.queryByRole("button", { name: "Polyglot" })).toBeNull()
    expect(screen.queryByRole("button", { name: /polyglot/i })).toBeNull()
  })

  it("features a badge from the add grid and posts the selection on save", async () => {
    const updated = gamification({ featured: ["sharp-ear"] })
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: updated }))
    vi.stubGlobal("fetch", fetchMock)
    const onSaved = vi.fn()

    render(<FeaturedBadgeEditor gamification={gamification()} catalogue={catalogue()} onSaved={onSaved} />)

    expect(saveButton().hasAttribute("disabled")).toBe(true)
    fireEvent.click(addTile("Sharp Ear"))
    expect(saveButton().hasAttribute("disabled")).toBe(false)

    fireEvent.click(saveButton())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/users/me/featured-badges")
    expect(init.method).toBe("PUT")
    expect(JSON.parse(init.body as string)).toEqual({ featured: ["sharp-ear"] })
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated))
  })

  it("unfeatures a badge from the strip and posts the shortened selection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: gamification() }))
    vi.stubGlobal("fetch", fetchMock)

    render(
      <FeaturedBadgeEditor
        gamification={gamification({ featured: ["most-loved", "sharp-ear"] })}
        catalogue={catalogue()}
        onSaved={vi.fn()}
      />,
    )

    fireEvent.click(unfeatureButton("Most Loved"))
    fireEvent.click(saveButton())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body as string)).toEqual({ featured: ["sharp-ear"] })
  })

  it("reorders a featured badge with the keyboard and posts the new order", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: gamification() }))
    vi.stubGlobal("fetch", fetchMock)

    render(
      <FeaturedBadgeEditor
        gamification={gamification({ featured: ["most-loved", "sharp-ear"] })}
        catalogue={catalogue()}
        onSaved={vi.fn()}
      />,
    )

    const leftmost = screen.getByLabelText("Most Loved")
    // Arrowing left off the front edge is a no-op, so nothing is dirty yet.
    fireEvent.keyDown(leftmost, { key: "ArrowLeft" })
    expect(saveButton().hasAttribute("disabled")).toBe(true)

    fireEvent.keyDown(leftmost, { key: "ArrowRight" })
    expect(saveButton().hasAttribute("disabled")).toBe(false)

    fireEvent.click(saveButton())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body as string)).toEqual({ featured: ["sharp-ear", "most-loved"] })
  })

  it("disables the add grid when the featured cap is reached", () => {
    render(
      <FeaturedBadgeEditor
        gamification={gamification({ featured: ["most-loved", "sharp-ear"] })}
        catalogue={catalogue(2)}
        onSaved={vi.fn()}
      />,
    )
    const trailblazer = addTile("Trailblazer")
    expect(trailblazer.hasAttribute("disabled")).toBe(true)
    fireEvent.click(trailblazer)
    // Still disabled and unfeatured: clicking a capped tile does nothing.
    expect(addTile("Trailblazer").hasAttribute("disabled")).toBe(true)
  })

  it("keeps the selection and shows a message when the server rejects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: false, error: "Invalid featured badges" }, 400))
    vi.stubGlobal("fetch", fetchMock)
    const onSaved = vi.fn()

    render(<FeaturedBadgeEditor gamification={gamification()} catalogue={catalogue()} onSaved={onSaved} />)

    fireEvent.click(addTile("Sharp Ear"))
    fireEvent.click(saveButton())

    await waitFor(() => expect(screen.getByText("Invalid featured badges")).toBeTruthy())
    expect(onSaved).not.toHaveBeenCalled()
    expect(saveButton().hasAttribute("disabled")).toBe(false)
  })

  it("reverts pending edits on reset", () => {
    render(<FeaturedBadgeEditor gamification={gamification()} catalogue={catalogue()} onSaved={vi.fn()} />)
    fireEvent.click(addTile("Sharp Ear"))
    expect(saveButton().hasAttribute("disabled")).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "Reset" }))
    expect(saveButton().hasAttribute("disabled")).toBe(true)
    expect(screen.queryByRole("button", { name: /unfeature sharp ear/i })).toBeNull()
  })

  it("renders nothing when no badges are earned", () => {
    render(
      <FeaturedBadgeEditor
        gamification={gamification({ badges: gamification().badges.map((b) => ({ ...b, earned: false })) })}
        catalogue={catalogue()}
        onSaved={vi.fn()}
      />,
    )
    expect(screen.queryByTestId("featured-badge-editor")).toBeNull()
  })
})
