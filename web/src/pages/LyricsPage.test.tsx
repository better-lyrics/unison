import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { VariantFull, VariantSummary } from "@/lib/types"

const seekTo = vi.fn()
const play = vi.fn()
let lastLineClick: ((seconds: number) => void) | null = null

vi.mock("@/hooks/useYouTubePlayer", () => ({
  useYouTubePlayer: () => ({
    ref: () => {},
    getCurrentTime: () => 0,
    getPlaying: () => false,
    seekTo,
    play,
  }),
}))

vi.mock("@/components/LyricsRenderer", () => ({
  LyricsRenderer: (props: { variant: VariantFull; onLineClick?: (s: number) => void }) => {
    lastLineClick = props.onLineClick ?? null
    return <div data-testid="lyrics-renderer">{`variant:${props.variant.id}`}</div>
  },
}))

vi.mock("@/components/VoteControls", () => ({
  VoteControls: (props: {
    variantId: number
    videoId: string
    variant: { score: number; userVote: 1 | -1 | null }
  }) => (
    <div
      data-testid="vote-controls"
      data-variant-id={props.variantId}
      data-video-id={props.videoId}
      data-score={props.variant.score}
      data-user-vote={props.variant.userVote === null ? "null" : String(props.variant.userVote)}
    />
  ),
}))

const fetchVariants = vi.fn()
const fetchVariant = vi.fn()
vi.mock("@/lib/api", () => ({
  fetchLyricsVariants: (...args: unknown[]) => fetchVariants(...args),
  fetchLyricsVariant: (...args: unknown[]) => fetchVariant(...args),
}))

import { LyricsPage } from "./LyricsPage"

function makeSummary(overrides: Partial<VariantSummary> = {}): VariantSummary {
  return {
    id: 1,
    videoId: "v1",
    song: "Song",
    artist: "Artist",
    format: "ttml",
    syncType: "richsync",
    score: 1,
    effectiveScore: 1.5,
    voteCount: 2,
    confidence: "medium",
    hidden: false,
    ...overrides,
  }
}

function makeFull(overrides: Partial<VariantFull> = {}): VariantFull {
  return {
    ...makeSummary(overrides),
    lyrics: "<tt></tt>",
    ...overrides,
  } as VariantFull
}

function createTestClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } } })
}

function renderAt(initialEntries: string[]) {
  const client = createTestClient()
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route path="/song/:videoId" element={<LyricsPage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  seekTo.mockReset()
  play.mockReset()
  lastLineClick = null
  fetchVariants.mockReset()
  fetchVariant.mockReset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("LyricsPage", () => {
  it("shows the loading state while the variants list is pending", async () => {
    fetchVariants.mockReturnValue(new Promise(() => {}))
    const { container } = renderAt(["/song/v1"])
    await waitFor(() => expect(container.querySelector(".animate-pulse")).toBeTruthy())
  })

  it("shows the empty state when the variants list is empty", async () => {
    fetchVariants.mockResolvedValue({ variants: [] })
    renderAt(["/song/v1"])
    await waitFor(() => expect(screen.getByText(/No lyrics yet/i)).toBeTruthy())
  })

  it("shows an error state when the variants request fails", async () => {
    fetchVariants.mockRejectedValue(new Error("boom"))
    renderAt(["/song/v1"])
    await waitFor(() => expect(screen.getByText(/Could not load lyrics/i)).toBeTruthy())
    expect(screen.getByText(/boom/)).toBeTruthy()
  })

  it("selects the first variant when no variantId is in the URL", async () => {
    fetchVariants.mockResolvedValue({ variants: [makeSummary({ id: 1 }), makeSummary({ id: 2 })] })
    fetchVariant.mockResolvedValue({ variant: makeFull({ id: 1 }) })
    renderAt(["/song/v1"])
    await waitFor(() => expect(screen.getByTestId("lyrics-renderer").textContent).toContain("variant:1"))
  })

  it("selects the variant from the URL when variantId is set", async () => {
    fetchVariants.mockResolvedValue({ variants: [makeSummary({ id: 1 }), makeSummary({ id: 2 })] })
    fetchVariant.mockResolvedValue({ variant: makeFull({ id: 2 }) })
    renderAt(["/song/v1?variantId=2"])
    await waitFor(() => expect(screen.getByTestId("lyrics-renderer").textContent).toContain("variant:2"))
  })

  it("switching variants updates the URL and refetches the variant", async () => {
    fetchVariants.mockResolvedValue({ variants: [makeSummary({ id: 1 }), makeSummary({ id: 2 })] })
    fetchVariant.mockResolvedValueOnce({ variant: makeFull({ id: 1 }) })
    fetchVariant.mockResolvedValueOnce({ variant: makeFull({ id: 2 }) })
    renderAt(["/song/v1"])
    await waitFor(() => expect(screen.getByTestId("lyrics-renderer")).toBeTruthy())
    const rows = screen.getAllByRole("button", { name: /\#\d/i })
    const target = rows.find((b) => b.getAttribute("aria-current") !== "true")
    if (!target) throw new Error("expected a non-selected row")
    fireEvent.click(target)
    await waitFor(() => expect(fetchVariant).toHaveBeenCalledTimes(2))
  })

  it("defaults to the synced mode and shows the renderer", async () => {
    fetchVariants.mockResolvedValue({ variants: [makeSummary({ id: 1 })] })
    fetchVariant.mockResolvedValue({ variant: makeFull({ id: 1, lyrics: "hello world" }) })
    renderAt(["/song/v1"])
    await waitFor(() => expect(screen.getByTestId("lyrics-renderer")).toBeTruthy())
    expect(screen.queryByText("hello world")).toBeNull()
  })

  it("switches to raw mode and renders the body verbatim", async () => {
    fetchVariants.mockResolvedValue({ variants: [makeSummary({ id: 1 })] })
    fetchVariant.mockResolvedValue({ variant: makeFull({ id: 1, lyrics: "raw body lines" }) })
    renderAt(["/song/v1"])
    await waitFor(() => expect(screen.getByTestId("lyrics-renderer")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: /raw/i }))
    expect(screen.getByText("raw body lines")).toBeTruthy()
    expect(screen.queryByTestId("lyrics-renderer")).toBeNull()
  })

  it("toggles back to synced mode from raw", async () => {
    fetchVariants.mockResolvedValue({ variants: [makeSummary({ id: 1 })] })
    fetchVariant.mockResolvedValue({ variant: makeFull({ id: 1, lyrics: "body" }) })
    renderAt(["/song/v1"])
    await waitFor(() => expect(screen.getByTestId("lyrics-renderer")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: /raw/i }))
    expect(screen.queryByTestId("lyrics-renderer")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /synced/i }))
    expect(screen.getByTestId("lyrics-renderer")).toBeTruthy()
  })

  it("clicking copy writes the lyrics body to the clipboard", async () => {
    fetchVariants.mockResolvedValue({ variants: [makeSummary({ id: 1 })] })
    fetchVariant.mockResolvedValue({ variant: makeFull({ id: 1, lyrics: "to copy" }) })
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } })
    renderAt(["/song/v1"])
    await waitFor(() => expect(screen.getByTestId("lyrics-renderer")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: /raw/i }))
    fireEvent.click(screen.getByRole("button", { name: /copy/i }))
    expect(writeText).toHaveBeenCalledWith("to copy")
  })

  it("shows the Copied! label on a successful write and reverts after the timer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      fetchVariants.mockResolvedValue({ variants: [makeSummary({ id: 1 })] })
      fetchVariant.mockResolvedValue({ variant: makeFull({ id: 1, lyrics: "ok" }) })
      const writeText = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } })
      renderAt(["/song/v1"])
      await waitFor(() => expect(screen.getByTestId("lyrics-renderer")).toBeTruthy())
      fireEvent.click(screen.getByRole("button", { name: /raw/i }))
      fireEvent.click(screen.getByRole("button", { name: /copy lyrics body to clipboard/i }))
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /copy lyrics body to clipboard/i }).textContent).toBe("Copied!"),
      )
      vi.advanceTimersByTime(1500)
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /copy lyrics body to clipboard/i }).textContent).toBe("Copy"),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it("shows the Copy failed label when the clipboard write rejects and reverts after the timer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      fetchVariants.mockResolvedValue({ variants: [makeSummary({ id: 1 })] })
      fetchVariant.mockResolvedValue({ variant: makeFull({ id: 1, lyrics: "ok" }) })
      const writeText = vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError"))
      vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } })
      renderAt(["/song/v1"])
      await waitFor(() => expect(screen.getByTestId("lyrics-renderer")).toBeTruthy())
      fireEvent.click(screen.getByRole("button", { name: /raw/i }))
      fireEvent.click(screen.getByRole("button", { name: /copy lyrics body to clipboard/i }))
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /copy lyrics body to clipboard/i }).textContent).toBe("Copy failed"),
      )
      vi.advanceTimersByTime(2500)
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /copy lyrics body to clipboard/i }).textContent).toBe("Copy"),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it("renders the hidden banner when the selected variant is hidden", async () => {
    fetchVariants.mockResolvedValue({ variants: [makeSummary({ id: 1 })] })
    fetchVariant.mockResolvedValue({ variant: makeFull({ id: 1, hidden: true }) })
    renderAt(["/song/v1"])
    await waitFor(() => expect(screen.getByText(/auto-hidden/i)).toBeTruthy())
  })

  it("renders VoteControls with the selected variant's score and userVote", async () => {
    fetchVariants.mockResolvedValue({ variants: [makeSummary({ id: 1 })] })
    fetchVariant.mockResolvedValue({ variant: makeFull({ id: 1, score: 5, userVote: -1 }) })
    renderAt(["/song/v1"])
    const controls = await screen.findByTestId("vote-controls")
    expect(controls.getAttribute("data-variant-id")).toBe("1")
    expect(controls.getAttribute("data-video-id")).toBe("v1")
    expect(controls.getAttribute("data-score")).toBe("5")
    expect(controls.getAttribute("data-user-vote")).toBe("-1")
  })

  it("seeks and starts the player when the renderer fires an onLineClick", async () => {
    fetchVariants.mockResolvedValue({ variants: [makeSummary({ id: 1 })] })
    fetchVariant.mockResolvedValue({ variant: makeFull({ id: 1 }) })
    renderAt(["/song/v1"])
    await waitFor(() => expect(lastLineClick).not.toBeNull())
    lastLineClick?.(8.5)
    expect(seekTo).toHaveBeenCalledWith(8.5)
    // Seeking a paused player leaves it paused, so the click has to say play as well.
    expect(play).toHaveBeenCalledTimes(1)
  })
})
