import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { FeaturedBadgeEditor } from "@/components/FeaturedBadgeEditor"
import type { BadgeCatalogue, BadgeDef, UserGamification } from "@/lib/types"

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
    image: { color: `/badge-art/${key}.svg`, mono: `/badge-art/${key}_mono.svg` },
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

function badge(name: string): HTMLElement {
  return screen.getByRole("button", { name })
}

describe("FeaturedBadgeEditor", () => {
  it("lists earned badges and preselects the current featured set", () => {
    render(
      <FeaturedBadgeEditor gamification={gamification({ featured: ["most-loved"] })} catalogue={catalogue()} onSaved={vi.fn()} />,
    )
    expect(badge("Most Loved").getAttribute("aria-pressed")).toBe("true")
    expect(badge("Sharp Ear").getAttribute("aria-pressed")).toBe("false")
  })

  it("does not offer locked badges", () => {
    render(<FeaturedBadgeEditor gamification={gamification()} catalogue={catalogue()} onSaved={vi.fn()} />)
    expect(screen.queryByRole("button", { name: "Polyglot" })).toBeNull()
  })

  it("enables save after a change and posts the selection", async () => {
    const updated = gamification({
      featured: ["sharp-ear"],
      badges: gamification().badges.map((b) => ({ ...b, featured: b.key === "sharp-ear" })),
    })
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: updated }))
    vi.stubGlobal("fetch", fetchMock)
    const onSaved = vi.fn()

    render(<FeaturedBadgeEditor gamification={gamification()} catalogue={catalogue()} onSaved={onSaved} />)

    const save = screen.getByRole("button", { name: "Save" })
    expect(save.hasAttribute("disabled")).toBe(true)

    fireEvent.click(badge("Sharp Ear"))
    expect(save.hasAttribute("disabled")).toBe(false)

    fireEvent.click(save)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/users/me/featured-badges")
    expect(init.method).toBe("PUT")
    expect(JSON.parse(init.body as string)).toEqual({ featured: ["sharp-ear"] })
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated))
  })

  it("caps the selection at featuredMax and disables the rest", () => {
    render(
      <FeaturedBadgeEditor
        gamification={gamification({ featured: ["most-loved", "sharp-ear"] })}
        catalogue={catalogue(2)}
        onSaved={vi.fn()}
      />,
    )
    const trailblazer = badge("Trailblazer")
    expect(trailblazer.hasAttribute("disabled")).toBe(true)
    fireEvent.click(trailblazer)
    expect(trailblazer.getAttribute("aria-pressed")).toBe("false")
  })

  it("keeps the selection and shows a message when the server rejects", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: false, error: "Invalid featured badges" }, 400))
    vi.stubGlobal("fetch", fetchMock)
    const onSaved = vi.fn()

    render(<FeaturedBadgeEditor gamification={gamification()} catalogue={catalogue()} onSaved={onSaved} />)

    fireEvent.click(badge("Sharp Ear"))
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(screen.getByText("Invalid featured badges")).toBeTruthy())
    expect(onSaved).not.toHaveBeenCalled()
    expect(badge("Sharp Ear").getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(false)
  })

  it("reverts pending edits on reset", () => {
    render(
      <FeaturedBadgeEditor gamification={gamification({ featured: ["most-loved"] })} catalogue={catalogue()} onSaved={vi.fn()} />,
    )
    fireEvent.click(badge("Sharp Ear"))
    expect(badge("Sharp Ear").getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: "Reset" }))
    expect(badge("Sharp Ear").getAttribute("aria-pressed")).toBe("false")
    expect(badge("Most Loved").getAttribute("aria-pressed")).toBe("true")
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
