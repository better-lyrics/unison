import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BadgeCatalogueProvider } from "@/components/BadgeCatalogueContext"
import { clearAsyncDataCache } from "@/hooks/useAsyncData"
import { seedBadgeCatalogue } from "@/lib/dev-seed"
import type { BadgeCatalogue, Mark, VariantFull, VariantSubmitter } from "@/lib/types"
import { VariantMetadata } from "./VariantMetadata"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

let catalogue: BadgeCatalogue

beforeEach(async () => {
  catalogue = await seedBadgeCatalogue()
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url.includes("/badges")) return jsonResponse({ success: true, data: catalogue })
      return jsonResponse({ success: true, data: { artworkUrl: null } })
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  clearAsyncDataCache()
})

function makeSubmitter(overrides: Partial<VariantSubmitter> = {}): VariantSubmitter {
  return {
    keyId: "abcdef0123456789012345678901wxyz",
    reputation: 1.3,
    displayName: "Nova",
    tier: null,
    level: 1,
    badgeCount: 0,
    topBadge: null,
    featured: [],
    ...overrides,
  }
}

function makeVariant(overrides: Partial<VariantFull> = {}): VariantFull {
  return {
    id: 1,
    videoId: "vid",
    song: "Midnight City",
    artist: "M83",
    format: "ttml",
    syncType: "richsync",
    score: 12,
    effectiveScore: 12.4,
    voteCount: 9,
    confidence: "high",
    hidden: false,
    lyrics: "<tt></tt>",
    ...overrides,
  }
}

function renderMeta(variant: VariantFull) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <BadgeCatalogueProvider>
        <MemoryRouter>
          <VariantMetadata variant={variant} />
        </MemoryRouter>
      </BadgeCatalogueProvider>
    </QueryClientProvider>,
  )
}

describe("VariantMetadata", () => {
  it("renders song and artist", () => {
    renderMeta(makeVariant())
    expect(screen.getByText("Midnight City")).toBeTruthy()
    expect(screen.getByText("M83")).toBeTruthy()
  })

  it("renders the album when present", () => {
    renderMeta(makeVariant({ album: "Hurry Up, We're Dreaming" }))
    expect(screen.getByText("Hurry Up, We're Dreaming")).toBeTruthy()
  })

  it("omits the album when missing", () => {
    renderMeta(makeVariant())
    expect(screen.queryByText("Hurry Up, We're Dreaming")).toBeNull()
  })

  it("renders ISRC and the language pill when present", () => {
    renderMeta(makeVariant({ isrc: "USRC12345678", language: "en" }))
    expect(screen.getByText("USRC12345678")).toBeTruthy()
    expect(screen.getByText("EN")).toBeTruthy()
  })

  it("omits the ISRC row when missing", () => {
    renderMeta(makeVariant())
    expect(screen.queryByText("USRC12345678")).toBeNull()
    expect(screen.queryByText("ISRC")).toBeNull()
  })

  it("renders the uppercase format pill", () => {
    renderMeta(makeVariant({ format: "lrc" }))
    expect(screen.getByText("LRC")).toBeTruthy()
  })

  it("renders the sync type pill as-is", () => {
    renderMeta(makeVariant({ syncType: "linesync" }))
    expect(screen.getByText("linesync")).toBeTruthy()
  })

  it("renders the effective score with one decimal and the raw score in parentheses", () => {
    renderMeta(makeVariant({ score: 12, effectiveScore: 12.42 }))
    expect(screen.getByText(/12\.4/)).toBeTruthy()
    expect(screen.getByText(/\(12\)/)).toBeTruthy()
  })

  it("renders the vote count as a plain non-negative number", () => {
    renderMeta(makeVariant({ voteCount: 24 }))
    expect(screen.getByText("24")).toBeTruthy()
  })

  it("renders 0 when vote count is zero", () => {
    renderMeta(makeVariant({ voteCount: 0 }))
    expect(screen.getByText("0")).toBeTruthy()
  })

  it("renders the confidence label", () => {
    renderMeta(makeVariant({ confidence: "low" }))
    expect(screen.getByText("low")).toBeTruthy()
  })

  it("renders the submitter row with a truncated keyId, name, rep, and link", () => {
    const keyId = "abcdef0123456789012345678901wxyz"
    renderMeta(makeVariant({ submitter: makeSubmitter({ keyId }) }))
    const link = screen.getByRole("link")
    expect(link.getAttribute("href")).toBe(`/curator/${keyId}`)
    expect(link.textContent).toContain("Nova")
    expect(link.textContent).toContain("abcdef01")
    expect(link.textContent).toContain("wxyz")
    expect(screen.getByText(/1\.3/)).toBeTruthy()
  })

  it("renders the submitter tier chip when a tier is present", () => {
    renderMeta(makeVariant({ submitter: makeSubmitter({ tier: "master" }) }))
    expect(screen.getByText("Master")).toBeTruthy()
  })

  it("renders featured badge icons in the submitter row", async () => {
    renderMeta(makeVariant({ submitter: makeSubmitter({ featured: [{ key: "prolific", name: "Prolific" }] }) }))
    await waitFor(() => expect(screen.getByAltText("Prolific")).toBeTruthy())
  })

  it("omits the submitter row when absent", () => {
    renderMeta(makeVariant())
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("renders the hidden warning banner when hidden is true", () => {
    renderMeta(makeVariant({ hidden: true }))
    expect(screen.getByText(/auto-hidden by community downvotes/i)).toBeTruthy()
  })

  it("omits the hidden banner when hidden is false", () => {
    renderMeta(makeVariant({ hidden: false }))
    expect(screen.queryByText(/auto-hidden/i)).toBeNull()
  })

  describe("cover art", () => {
    it("falls back to the youtube thumbnail when there is no resolved artwork", async () => {
      const { container } = renderMeta(makeVariant({ videoId: "kJQP7kiw5Fk" }))
      await waitFor(() => {
        const cover = container.querySelector('img[src*="ytimg.com"]')
        expect(cover).not.toBeNull()
      })
      expect(container.querySelector('img[src*="kJQP7kiw5Fk/maxresdefault.jpg"]')).not.toBeNull()
    })
  })

  describe("tooltips", () => {
    it("shows the richsync tooltip on hover", async () => {
      renderMeta(makeVariant({ syncType: "richsync" }))
      fireEvent.mouseEnter(screen.getByText("richsync"))
      const tip = await screen.findByRole("tooltip")
      expect(tip.textContent).toContain("Word-by-word synced lyrics")
    })
  })

  describe("marks", () => {
    function makeSeal(overrides: Partial<Mark> = {}): Mark {
      return {
        type: "seal",
        label: "Better Lyrics Council Approved (BLCA)",
        icon: "/badges/committee/image.svg",
        ...overrides,
      }
    }

    it("renders a mark using its server-passed label and icon", () => {
      const { container } = renderMeta(makeVariant({ marks: [makeSeal()] }))
      expect(screen.getByText("Better Lyrics Council Approved (BLCA)")).toBeTruthy()
      expect(container.querySelector('img[src="/badges/committee/image.svg"]')).not.toBeNull()
    })

    it("links to the approving member's profile when `by` is present", () => {
      const keyId = "committeekey0123456789012345abcd"
      renderMeta(
        makeVariant({
          marks: [
            makeSeal({
              by: { keyId, displayName: "Kiyoshi", tier: "master", level: 12, badgeCount: 4, topBadge: null },
            }),
          ],
        }),
      )
      const link = screen.getByRole("link", { name: /Kiyoshi/i })
      expect(link.getAttribute("href")).toBe(`/curator/${keyId}`)
    })

    it("omits the `by` attribution when the actor is absent", () => {
      renderMeta(makeVariant({ marks: [makeSeal()] }))
      expect(screen.queryByRole("link")).toBeNull()
    })

    it("renders an unknown mark type generically from label and icon", () => {
      renderMeta(
        makeVariant({
          marks: [{ type: "spotlight", label: "Editor's pick", icon: "/badges/spotlight/image.svg" }],
        }),
      )
      expect(screen.getByText("Editor's pick")).toBeTruthy()
    })

    it("renders every mark when several are present", () => {
      renderMeta(
        makeVariant({
          marks: [makeSeal(), { type: "spotlight", label: "Editor's pick", icon: "/badges/spotlight/image.svg" }],
        }),
      )
      expect(screen.getByText("Better Lyrics Council Approved (BLCA)")).toBeTruthy()
      expect(screen.getByText("Editor's pick")).toBeTruthy()
    })

    it("renders nothing seal-like when there are no marks", () => {
      renderMeta(makeVariant())
      expect(screen.queryByText(/Approved/i)).toBeNull()
    })
  })
})
