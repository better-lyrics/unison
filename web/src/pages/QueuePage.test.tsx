import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { QueueEntry } from "@/lib/types"

const fetchQueueMock = vi.fn()
vi.mock("@/lib/api", () => ({
  fetchQueue: (...args: unknown[]) => fetchQueueMock(...args),
}))

import { QueuePage } from "./QueuePage"

type ObserverCallback = (entries: { isIntersecting: boolean }[]) => void

interface StubObserver {
  observe: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

const observerCallbacks: ObserverCallback[] = []
const observerInstances: StubObserver[] = []

class IntersectionObserverStub {
  observe: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  constructor(cb: ObserverCallback) {
    observerCallbacks.push(cb)
    this.observe = vi.fn()
    this.disconnect = vi.fn()
    observerInstances.push(this as unknown as StubObserver)
  }
}

function createTestClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } } })
}

function renderPage(): { client: QueryClient } {
  const client = createTestClient()
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <QueuePage />
      </QueryClientProvider>
    </MemoryRouter>,
  )
  return { client }
}

function makeEntry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    rank: 1,
    videoId: "vid1",
    song: "Wanted Song",
    artist: "Wanted Artist",
    thumbnailUrl: null,
    demand: 42,
    requestCount: 7,
    ...overrides,
  }
}

beforeEach(() => {
  fetchQueueMock.mockReset()
  observerCallbacks.length = 0
  observerInstances.length = 0
  // biome-ignore lint/suspicious/noExplicitAny: stubbing a DOM global in tests
  vi.stubGlobal("IntersectionObserver", IntersectionObserverStub as any)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("QueuePage", () => {
  it("renders the loading placeholder while the first page is pending", async () => {
    fetchQueueMock.mockReturnValue(new Promise(() => {}))
    const { container } = render(
      <MemoryRouter>
        <QueryClientProvider client={createTestClient()}>
          <QueuePage />
        </QueryClientProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(container.querySelector(".animate-pulse")).toBeTruthy())
  })

  it("renders an error state when the query rejects", async () => {
    fetchQueueMock.mockRejectedValue(new Error("network blew up"))
    renderPage()
    await waitFor(() => expect(screen.getByText("Could not load the queue")).toBeTruthy())
    expect(screen.getByText(/network blew up/)).toBeTruthy()
  })

  it("renders the empty state when the queue has no entries", async () => {
    fetchQueueMock.mockResolvedValue({ items: [], nextCursor: null })
    renderPage()
    await waitFor(() => expect(screen.getByText("Nothing in the queue right now")).toBeTruthy())
    expect(screen.getByText(/Better Lyrics extension/)).toBeTruthy()
  })

  it("renders the page header with title and subtitle", async () => {
    fetchQueueMock.mockResolvedValue({ items: [makeEntry()], nextCursor: null })
    renderPage()
    await waitFor(() => expect(screen.getByRole("heading", { name: "Queue" })).toBeTruthy())
    expect(screen.getByText(/reputation-weighted demand/i)).toBeTruthy()
  })

  it("renders rows for a single page and hides the loading-more indicator", async () => {
    fetchQueueMock.mockResolvedValue({
      items: [
        makeEntry({ videoId: "vid1", song: "Song One" }),
        makeEntry({ videoId: "vid2", song: "Song Two", rank: 2 }),
      ],
      nextCursor: null,
    })
    renderPage()
    await waitFor(() => expect(screen.getByText("Song One")).toBeTruthy())
    expect(screen.getByText("Song Two")).toBeTruthy()
    expect(screen.queryByText(/loading more/i)).toBeNull()
    expect(screen.getByText(/end of the queue/i)).toBeTruthy()
  })

  it("shows the loading-more shimmer indicator when more pages are available", async () => {
    fetchQueueMock.mockResolvedValue({
      items: [makeEntry({ videoId: "vid1", song: "Song One" })],
      nextCursor: "page2",
    })
    renderPage()
    await waitFor(() => expect(screen.getByText("Song One")).toBeTruthy())
    const indicator = screen.getByText(/loading more/i)
    expect(indicator.className).toMatch(/unison-shimmer-text/)
  })

  it("renders a continuous rank sequence across paginated pages", async () => {
    const page1Items = Array.from({ length: 3 }, (_, i) =>
      makeEntry({ videoId: `p1-${i + 1}`, song: `Page One Song ${i + 1}`, rank: i + 1 }),
    )
    const page2Items = Array.from({ length: 3 }, (_, i) =>
      makeEntry({ videoId: `p2-${i + 1}`, song: `Page Two Song ${i + 1}`, rank: i + 1 }),
    )
    fetchQueueMock
      .mockResolvedValueOnce({ items: page1Items, nextCursor: "p2" })
      .mockResolvedValueOnce({ items: page2Items, nextCursor: null })
    renderPage()
    await waitFor(() => expect(screen.getByText("Page One Song 1")).toBeTruthy())
    await waitFor(() => expect(observerCallbacks.length).toBeGreaterThan(0))
    act(() => {
      observerCallbacks[observerCallbacks.length - 1]([{ isIntersecting: true }])
    })
    await waitFor(() => expect(screen.getByText("Page Two Song 3")).toBeTruthy())
    const renderedRanks = screen.getAllByText(/^#\d+$/).map((node) => node.textContent)
    expect(renderedRanks).toEqual(["#1", "#2", "#3", "#4", "#5", "#6"])
  })

  it("hides the loading-more indicator once the last page resolves with no next cursor", async () => {
    fetchQueueMock
      .mockResolvedValueOnce({
        items: [makeEntry({ videoId: "vid1", song: "Song One" })],
        nextCursor: "page2",
      })
      .mockResolvedValueOnce({
        items: [makeEntry({ videoId: "vid2", song: "Song Two", rank: 51 })],
        nextCursor: null,
      })
    renderPage()
    await waitFor(() => expect(screen.getByText("Song One")).toBeTruthy())
    await waitFor(() => expect(observerCallbacks.length).toBeGreaterThan(0))
    act(() => {
      observerCallbacks[observerCallbacks.length - 1]([{ isIntersecting: true }])
    })
    await waitFor(() => expect(screen.getByText("Song Two")).toBeTruthy())
    await waitFor(() => expect(screen.queryByText(/loading more/i)).toBeNull())
    expect(screen.getByText(/end of the queue/i)).toBeTruthy()
  })

  it("auto-loads the next page when the sentinel intersects the viewport", async () => {
    fetchQueueMock
      .mockResolvedValueOnce({
        items: [makeEntry({ videoId: "vid1", song: "Song One" })],
        nextCursor: "page2",
      })
      .mockResolvedValueOnce({
        items: [makeEntry({ videoId: "vid2", song: "Song Two", rank: 51 })],
        nextCursor: null,
      })
    renderPage()
    await waitFor(() => expect(screen.getByText("Song One")).toBeTruthy())
    await waitFor(() => expect(observerCallbacks.length).toBeGreaterThan(0))
    act(() => {
      observerCallbacks[observerCallbacks.length - 1]([{ isIntersecting: true }])
    })
    await waitFor(() => expect(screen.getByText("Song Two")).toBeTruthy())
    expect(fetchQueueMock).toHaveBeenCalledTimes(2)
    expect(fetchQueueMock.mock.calls[1][0]).toMatchObject({ cursor: "page2" })
  })

  it("renders entries as a list with each row as a list item for accessibility", async () => {
    fetchQueueMock.mockResolvedValue({
      items: [makeEntry({ videoId: "vid1", song: "Song One" })],
      nextCursor: null,
    })
    renderPage()
    await waitFor(() => expect(screen.getByText("Song One")).toBeTruthy())
    const lists = screen.getAllByRole("list")
    expect(lists.length).toBeGreaterThan(0)
    const items = screen.getAllByRole("listitem")
    expect(items.length).toBeGreaterThan(0)
  })
})
