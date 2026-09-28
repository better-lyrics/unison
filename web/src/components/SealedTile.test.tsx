import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { FeedEntry, Mark } from "@/lib/types"
import { SealedTile, SealedTileSkeleton } from "./SealedTile"

const NOW = 1_760_000_000
const SEAL: Mark = {
  type: "seal",
  label: "Better Lyrics Council Approved (BLCA)",
  icon: "/badges/committee/image.svg",
  at: NOW - 2 * 86400,
}

function entry(overrides: Partial<FeedEntry> = {}): FeedEntry {
  return {
    id: 7,
    videoId: "HsBfV2A5dUY",
    song: "Espresso",
    artist: "Sabrina Carpenter",
    syncType: "richsync",
    createdAt: NOW - 30 * 86400,
    marks: [SEAL],
    submitter: {
      keyId: "a".repeat(64),
      displayName: "mira",
      tier: null,
      level: 3,
      badgeCount: 0,
      topBadge: null,
      avatarUrl: null,
    },
    ...overrides,
  }
}

function renderUi(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { artworkUrl: null } }))),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("SealedTile", () => {
  describe("happy path", () => {
    it("links the whole tile to the song page", () => {
      renderUi(<SealedTile entry={entry()} variant="shelf" />)
      const link = screen.getByRole("link", { name: "Espresso by Sabrina Carpenter" })
      expect(link.getAttribute("href")).toBe("/song/HsBfV2A5dUY")
    })

    it("shows the song, artist and submitter", () => {
      renderUi(<SealedTile entry={entry()} variant="shelf" />)
      expect(screen.getByText("Espresso")).toBeTruthy()
      expect(screen.getByText("Sabrina Carpenter")).toBeTruthy()
      expect(screen.getByText("mira")).toBeTruthy()
    })

    it("renders the seal image from the mark icon", () => {
      const { container } = renderUi(<SealedTile entry={entry()} variant="shelf" />)
      expect(container.querySelector('img[src="/badges/committee/image.svg"]')).not.toBeNull()
    })

    it("shows the sync type and how long ago it was sealed on the card", () => {
      renderUi(<SealedTile entry={entry()} variant="card" now={NOW} />)
      expect(screen.getByText("Word synced")).toBeTruthy()
      expect(screen.getByText("2d ago")).toBeTruthy()
    })

    it("labels line-synced lyrics on the card", () => {
      renderUi(<SealedTile entry={entry({ syncType: "linesync" })} variant="card" now={NOW} />)
      expect(screen.getByText("Line synced")).toBeTruthy()
    })
  })

  describe("edge cases", () => {
    it("leaves out the sync type and elapsed time on the shelf", () => {
      renderUi(<SealedTile entry={entry()} variant="shelf" now={NOW} />)
      expect(screen.queryByText("Word synced")).toBeNull()
      expect(screen.queryByText("2d ago")).toBeNull()
    })

    it("renders no submitter row when there is no submitter", () => {
      renderUi(<SealedTile entry={entry({ submitter: undefined })} variant="card" now={NOW} />)
      expect(screen.queryByText("mira")).toBeNull()
    })

    it("renders no seal image when the entry has no seal mark", () => {
      const { container } = renderUi(<SealedTile entry={entry({ marks: [] })} variant="card" now={NOW} />)
      expect(container.querySelector('img[src="/badges/committee/image.svg"]')).toBeNull()
      expect(screen.queryByText(/ago$/)).toBeNull()
    })

    it("renders no elapsed time when the seal has no timestamp", () => {
      renderUi(<SealedTile entry={entry({ marks: [{ ...SEAL, at: undefined }] })} variant="card" now={NOW} />)
      expect(screen.queryByText(/ago$/)).toBeNull()
    })

    it("uses the seal mark even when other marks come first", () => {
      const spotlight: Mark = { type: "spotlight", label: "Pick", icon: "/badges/spotlight/image.svg" }
      const { container } = renderUi(
        <SealedTile entry={entry({ marks: [spotlight, SEAL] })} variant="card" now={NOW} />,
      )
      expect(container.querySelector('img[src="/badges/committee/image.svg"]')).not.toBeNull()
      expect(container.querySelector('img[src="/badges/spotlight/image.svg"]')).toBeNull()
    })

    it("truncates long names instead of wrapping", () => {
      renderUi(<SealedTile entry={entry({ song: "A".repeat(200) })} variant="shelf" />)
      expect(screen.getByText("A".repeat(200)).className).toContain("truncate")
    })
  })

  describe("entrance motion", () => {
    it("keeps the same link, text and seal when it animates in", () => {
      const { container } = renderUi(<SealedTile entry={entry()} variant="card" now={NOW} enterIndex={3} />)
      expect(screen.getByRole("link", { name: "Espresso by Sabrina Carpenter" }).getAttribute("href")).toBe(
        "/song/HsBfV2A5dUY",
      )
      expect(screen.getByText("2d ago")).toBeTruthy()
      expect(container.querySelector('img[src="/badges/committee/image.svg"]')).not.toBeNull()
    })

    it("regression: an animated seal takes its tilt from motion, not the rotate class, so it never tilts twice", () => {
      const { container } = renderUi(<SealedTile entry={entry()} variant="card" now={NOW} enterIndex={0} />)
      const seal = container.querySelector('img[src="/badges/committee/image.svg"]')
      expect(seal?.className).not.toContain("-rotate-6")
    })

    it("a static tile keeps the rotate class on its seal", () => {
      const { container } = renderUi(<SealedTile entry={entry()} variant="shelf" />)
      const seal = container.querySelector('img[src="/badges/committee/image.svg"]')
      expect(seal?.className).toContain("-rotate-6")
    })
  })

  describe("invariants", () => {
    it("the skeleton is hidden from assistive tech and has no links", () => {
      for (const variant of ["shelf", "card"] as const) {
        const { container, unmount } = renderUi(<SealedTileSkeleton variant={variant} />)
        expect(container.querySelector("a")).toBeNull()
        expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true")
        unmount()
      }
    })

    it("the shelf tile and its skeleton share the same fixed width", () => {
      const tile = renderUi(<SealedTile entry={entry()} variant="shelf" />)
      const tileWidth = tile.container.querySelector("a")?.className.match(/w-\[\d+px\]/)?.[0]
      tile.unmount()
      const bone = renderUi(<SealedTileSkeleton variant="shelf" />)
      expect(tileWidth).toBeDefined()
      expect(bone.container.firstElementChild?.className).toContain(tileWidth as string)
    })
  })
})
