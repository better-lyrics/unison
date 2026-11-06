import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { VariantFull } from "@/lib/types"
import { VariantCover } from "./VariantCover"

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ success: true, data: { artworkUrl: null } }))),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

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

function renderMeta(
  variant: VariantFull,
  player: {
    playerRef?: (node: HTMLDivElement | null) => void
    playerActive?: boolean
    onActivatePlayer?: () => void
  } = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <VariantCover variant={variant} {...player} />
    </QueryClientProvider>,
  )
}

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

describe("cover player", () => {
  it("shows a play button over the poster when the player can be activated", async () => {
    renderMeta(makeVariant(), { onActivatePlayer: () => {}, playerRef: () => {} })
    expect(await screen.findByRole("button", { name: /play/i })).toBeTruthy()
  })

  it("calls onActivatePlayer when the poster is clicked", async () => {
    const onActivatePlayer = vi.fn()
    renderMeta(makeVariant(), { onActivatePlayer, playerRef: () => {} })
    fireEvent.click(await screen.findByRole("button", { name: /play/i }))
    expect(onActivatePlayer).toHaveBeenCalledTimes(1)
  })

  it("mounts the player node and drops the poster button once active", () => {
    const playerRef = vi.fn()
    renderMeta(makeVariant(), { playerActive: true, onActivatePlayer: () => {}, playerRef })
    expect(playerRef).toHaveBeenCalledWith(expect.any(HTMLElement))
    expect(screen.queryByRole("button", { name: /play/i })).toBeNull()
  })

  it("renders a non-interactive poster when no activation handler is given", () => {
    renderMeta(makeVariant())
    expect(screen.queryByRole("button", { name: /play/i })).toBeNull()
  })
})
