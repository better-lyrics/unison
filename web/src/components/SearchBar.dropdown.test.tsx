import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, useLocation } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SearchBar } from "./SearchBar"

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="loc" data-path={location.pathname} data-search={location.search} />
}

const hit = {
  id: 7,
  videoId: "vid7",
  song: "Blinding Lights",
  artist: "The Weeknd",
  duration: 200,
  format: "ttml",
  syncType: "richsync",
  score: 1,
  effectiveScore: 9.4,
  voteCount: 128,
  confidence: "high",
}

function stubResults(data: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data }), { status: 200 })),
  )
}

function renderBar(initialEntries: string[] = ["/"]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } } })
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={client}>
        <SearchBar />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  stubResults([])
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function typeQuery(value: string) {
  const input = screen.getByRole("combobox", { name: /search lyrics/i })
  act(() => {
    input.focus()
  })
  act(() => {
    fireEvent.change(input, { target: { value } })
  })
  return input
}

describe("SearchBar suggestions dropdown", () => {
  it("shows the prompt state at one character", async () => {
    renderBar()
    await typeQuery("b")
    expect(await screen.findByText(/Search lyrics, songs, or artists/i)).toBeTruthy()
  })

  it("shows results after typing two or more characters", async () => {
    stubResults([hit])
    renderBar()
    await typeQuery("blinding")
    expect(await screen.findByText("Blinding Lights")).toBeTruthy()
  })

  it("navigates to the song when a row is clicked", async () => {
    stubResults([hit])
    renderBar()
    await typeQuery("blinding")
    const row = await screen.findByText("Blinding Lights")
    fireEvent.click(row)
    await waitFor(() => expect(screen.getByTestId("loc").getAttribute("data-path")).toBe("/song/vid7"))
    expect(screen.getByTestId("loc").getAttribute("data-search")).toBe("?variantId=7")
  })

  it("opens the highlighted row on Enter after ArrowDown", async () => {
    stubResults([hit])
    renderBar()
    const input = await typeQuery("blinding")
    await screen.findByText("Blinding Lights")
    fireEvent.keyDown(input, { key: "ArrowDown" })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(screen.getByTestId("loc").getAttribute("data-path")).toBe("/song/vid7"))
  })

  it("goes to the full search page on plain Enter with no highlight", async () => {
    stubResults([hit])
    renderBar()
    const input = await typeQuery("blinding")
    await screen.findByText("Blinding Lights")
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(screen.getByTestId("loc").getAttribute("data-path")).toBe("/search"))
    expect(screen.getByTestId("loc").getAttribute("data-search")).toBe("?q=blinding")
  })

  it("goes to the full search page on Cmd+Enter even with a highlight", async () => {
    stubResults([hit])
    renderBar()
    const input = await typeQuery("blinding")
    await screen.findByText("Blinding Lights")
    fireEvent.keyDown(input, { key: "ArrowDown" })
    fireEvent.keyDown(input, { key: "Enter", metaKey: true })
    await waitFor(() => expect(screen.getByTestId("loc").getAttribute("data-path")).toBe("/search"))
    expect(screen.getByTestId("loc").getAttribute("data-search")).toBe("?q=blinding")
  })

  it("shows the no-matches state when the search returns nothing", async () => {
    stubResults([])
    renderBar()
    await typeQuery("zzzz")
    expect(await screen.findByText(/No matches/i)).toBeTruthy()
  })

  it("focuses the input from a Cmd+/ shortcut", () => {
    renderBar()
    const input = screen.getByRole("combobox", { name: /search lyrics/i })
    expect(document.activeElement).not.toBe(input)
    fireEvent.keyDown(window, { key: "/", metaKey: true })
    expect(document.activeElement).toBe(input)
  })
})
