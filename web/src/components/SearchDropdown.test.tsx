import type { LyricsSearchHit } from "@/lib/types"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ReactElement } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { SearchDropdown } from "./SearchDropdown"

function renderDropdown(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const hits: LyricsSearchHit[] = [
  {
    id: 1,
    videoId: "v1",
    song: "Blinding Lights",
    artist: "The Weeknd",
    duration: 200,
    format: "ttml",
    syncType: "richsync",
    score: 1,
    effectiveScore: 9.4,
    voteCount: 128,
    confidence: "high",
  },
  {
    id: 2,
    videoId: "v2",
    song: "As It Was",
    artist: "Harry Styles",
    duration: 167,
    format: "lrc",
    syncType: "linesync",
    score: 1,
    effectiveScore: 8.9,
    voteCount: 96,
    confidence: "medium",
  },
]

afterEach(cleanup)

describe("SearchDropdown", () => {
  it("renders a row per result with song and artist", () => {
    renderDropdown(<SearchDropdown status="results" results={hits} activeIndex={null} getRowProps={() => ({})} />)
    expect(screen.getByText("Blinding Lights")).toBeTruthy()
    expect(screen.getByText("The Weeknd")).toBeTruthy()
    expect(screen.getByText("As It Was")).toBeTruthy()
  })

  it("marks only the active row with data-active", () => {
    const { container } = renderDropdown(
      <SearchDropdown status="results" results={hits} activeIndex={0} getRowProps={() => ({})} />,
    )
    expect(container.querySelectorAll("[data-active]")).toHaveLength(1)
  })

  it("fires the row props onClick when a row is clicked", () => {
    const clicked: number[] = []
    renderDropdown(
      <SearchDropdown
        status="results"
        results={hits}
        activeIndex={null}
        getRowProps={(index) => ({ onClick: () => clicked.push(index) })}
      />,
    )
    fireEvent.click(screen.getByText("As It Was"))
    expect(clicked).toEqual([1])
  })

  it("renders the footer key hints in results state", () => {
    renderDropdown(<SearchDropdown status="results" results={hits} activeIndex={null} getRowProps={() => ({})} />)
    expect(screen.getByText(/navigate/i)).toBeTruthy()
    expect(screen.getByText(/all results/i)).toBeTruthy()
  })

  it("renders the prompt state", () => {
    renderDropdown(<SearchDropdown status="prompt" results={[]} activeIndex={null} getRowProps={() => ({})} />)
    expect(screen.getByText(/Search lyrics, songs, or artists/i)).toBeTruthy()
  })

  it("renders five skeleton rows in loading state", () => {
    const { container } = renderDropdown(
      <SearchDropdown status="loading" results={[]} activeIndex={null} getRowProps={() => ({})} />,
    )
    expect(container.querySelectorAll("ul > li")).toHaveLength(5)
  })

  it("renders the no-matches state", () => {
    renderDropdown(<SearchDropdown status="empty" results={[]} activeIndex={null} getRowProps={() => ({})} />)
    expect(screen.getByText(/No matches/i)).toBeTruthy()
  })
})
