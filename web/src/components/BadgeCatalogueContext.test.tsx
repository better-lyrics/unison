import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { clearAsyncDataCache } from "@/hooks/useAsyncData"
import type { BadgeCatalogue } from "@/lib/types"
import { BadgeCatalogueProvider, useBadgeCatalogue } from "./BadgeCatalogueContext"

const catalogue: BadgeCatalogue = {
  badges: [
    {
      key: "most-loved",
      name: "Most Loved",
      description: "desc",
      category: "acclaim",
      kind: "medal",
      image: { color: "/c", mono: "/m" },
    },
  ],
  display: { inlineGlyphs: 1, featuredMax: 5, rarityThreshold: 0.1, categoryOrder: ["acclaim"] },
}

function stubCatalogueFetch() {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url === "/badges") {
      return Promise.resolve(new Response(JSON.stringify({ success: true, data: catalogue }), { status: 200 }))
    }
    return Promise.reject(new Error(`unexpected url ${url}`))
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function Consumer() {
  const state = useBadgeCatalogue()
  if (state.status !== "success") return <span>status:{state.status}</span>
  return (
    <div>
      <span data-testid="count">{state.data.badges.length}</span>
      <span data-testid="featured-max">{state.data.display.featuredMax}</span>
    </div>
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

describe("BadgeCatalogueContext", () => {
  it("exposes the catalogue badges and display to consumers", async () => {
    stubCatalogueFetch()
    render(
      <BadgeCatalogueProvider>
        <Consumer />
      </BadgeCatalogueProvider>,
    )
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("1"))
    expect(screen.getByTestId("featured-max").textContent).toBe("5")
  })

  it("fetches the catalogue once even with multiple consumers", async () => {
    const fetchMock = stubCatalogueFetch()
    render(
      <BadgeCatalogueProvider>
        <Consumer />
        <Consumer />
      </BadgeCatalogueProvider>,
    )
    await waitFor(() => expect(screen.getAllByTestId("count").length).toBe(2))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("throws when used outside a provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => render(<Consumer />)).toThrow(/BadgeCatalogueProvider/)
    spy.mockRestore()
  })

  describe("invariants", () => {
    it("serves the cached catalogue immediately on a later mount", async () => {
      stubCatalogueFetch()
      const first = render(
        <BadgeCatalogueProvider>
          <Consumer />
        </BadgeCatalogueProvider>,
      )
      await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("1"))
      first.unmount()
      render(
        <BadgeCatalogueProvider>
          <Consumer />
        </BadgeCatalogueProvider>,
      )
      expect(screen.getByTestId("count").textContent).toBe("1")
    })
  })
})
