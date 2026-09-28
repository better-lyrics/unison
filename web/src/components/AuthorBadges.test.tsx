import { BadgeCatalogueProvider } from "@/components/BadgeCatalogueContext"
import { seedBadgeCatalogue } from "@/lib/dev-seed"
import type { BadgeCatalogue } from "@/lib/types"
import { jsonResponse } from "@/test/fetch-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import type { ComponentProps } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthorBadges, BadgeStrip } from "./AuthorBadges"

let catalogue: BadgeCatalogue

beforeEach(async () => {
  catalogue = await seedBadgeCatalogue()
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse({ success: true, data: catalogue })),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const none = { tier: null, featured: [], topBadge: null, badgeCount: 0 }

function renderBadges(props: ComponentProps<typeof AuthorBadges>, withCatalogue = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const badges = <AuthorBadges {...props} />
  return render(
    <QueryClientProvider client={client}>
      {withCatalogue ? <BadgeCatalogueProvider>{badges}</BadgeCatalogueProvider> : badges}
    </QueryClientProvider>,
  )
}

describe("AuthorBadges", () => {
  it("shows the tier with its real gem", async () => {
    const { container } = renderBadges({ ...none, tier: "master" })
    await waitFor(() => expect(container.querySelector("[data-tier='master'] img")).toBeTruthy())
    expect(container.textContent).toContain("Master")
  })

  it("shows the featured badges as their artwork", async () => {
    renderBadges({ ...none, featured: [{ key: "prolific", name: "Prolific" }], badgeCount: 3 })
    expect(await screen.findByRole("img", { name: "Prolific" })).toBeTruthy()
  })

  describe("edge cases", () => {
    it("falls back to the top badge and a count of the rest", async () => {
      const { container } = renderBadges({
        ...none,
        topBadge: { key: "polyglot", name: "Polyglot", tier: 1 },
        badgeCount: 4,
      })
      expect(await screen.findByRole("img", { name: "Polyglot" })).toBeTruthy()
      expect(container.textContent).toContain("+3")
    })

    it("renders nothing for someone with no tier and no badges", () => {
      const { container } = renderBadges(none)
      expect(container.textContent).toBe("")
    })

    it("regression: leaves no empty box while a top badge image is still loading", () => {
      const { container } = renderBadges(
        { ...none, topBadge: { key: "polyglot", name: "Polyglot", tier: 1 }, badgeCount: 2 },
        false,
      )
      expect(container.innerHTML).toBe("")
    })

    it("still names the tier before the catalogue loads", () => {
      const { container } = renderBadges({ ...none, tier: "elite" }, false)
      expect(container.querySelector("[data-tier='elite']")?.textContent).toBe("Elite")
    })
  })
})

describe("BadgeStrip", () => {
  it("renders compact badges for dense rows", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <BadgeCatalogueProvider>
          <BadgeStrip size="sm" featured={[{ key: "prolific", name: "Prolific" }]} topBadge={null} badgeCount={1} />
        </BadgeCatalogueProvider>
      </QueryClientProvider>,
    )
    const img = await screen.findByRole("img", { name: "Prolific" })
    expect(img.getAttribute("class")).toContain("size-4")
  })
})
