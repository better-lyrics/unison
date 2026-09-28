import { __resetToastStore } from "@/lib/toast"
import { ME, NOW, OLA, bookmarkBy, councilData, queueItem, stubCouncilApi } from "@/test/council-fixtures"
import { jsonResponse } from "@/test/fetch-router"
import { renderCouncil } from "@/test/render-council"
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const HOUR = 3600
const DAY = 86400

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(Date, "now").mockReturnValue(NOW * 1000)
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  __resetToastStore()
})

function busy() {
  return councilData({
    queue: [
      queueItem({ id: 722, song: "Story of a Warrior", score: 0.97, voteCount: 39, bookmark: bookmarkBy(ME) }),
      queueItem({ id: 1320, song: "Run Rabbit", score: 0.95, voteCount: 29, createdAt: NOW - 4 * DAY }),
      queueItem({
        id: 1093,
        song: "Im Sorry Mom",
        score: 0.94,
        voteCount: 37,
        createdAt: NOW - 15 * DAY,
        flags: [
          { code: "not-sentence-case", label: "Capitalization" },
          { code: "filler-line", label: "Filler or instrumental lines" },
        ],
      }),
      queueItem({ id: 406, song: "Catch Catch", artist: "YENA", language: "ko", score: 0.96, voteCount: 28 }),
      queueItem({ id: 669, song: "Isn't She Lovely", bookmark: { ...bookmarkBy(OLA, 2), expiresAt: NOW + 5 * HOUR } }),
    ],
  })
}

const openList = () => screen.getByRole("list", { name: "Open candidates" })
const titles = (list: HTMLElement) =>
  within(list)
    .queryAllByRole("link")
    .map((l) => l.querySelector(".truncate")?.textContent)
const selected = () => document.querySelector("[aria-current='true'][data-key]")?.getAttribute("data-key")
const press = (key: string) => act(() => void fireEvent.keyDown(window, { key }))

describe("CouncilQueuePage list", () => {
  it("groups my bookmarks, open candidates and a collapsed list of other members' bookmarks", async () => {
    stubCouncilApi(busy())
    renderCouncil("/council/queue")
    await waitFor(() => expect(titles(openList())).toEqual(["Catch Catch", "Run Rabbit", "Im Sorry Mom"]))
    expect(titles(screen.getByRole("list", { name: "Your bookmarks" }))).toEqual(["Story of a Warrior"])
    expect(screen.getByText("Your bookmarks").parentElement?.textContent).toContain("1/5")
    const toggle = screen.getByRole("button", { name: /Bookmarked by others/ })
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByRole("list", { name: "Bookmarked by others" })).toBeNull()
    fireEvent.click(toggle)
    expect(titles(screen.getByRole("list", { name: "Bookmarked by others" }))).toEqual(["Isn't She Lovely"])
    expect(screen.getByRole("list", { name: "Bookmarked by others" }).textContent).toContain("5h left")
  })

  it("filters by text, flags and language, and sorts", async () => {
    stubCouncilApi(busy())
    renderCouncil("/council/queue")
    await waitFor(() => expect(titles(openList())).toHaveLength(3))
    fireEvent.change(screen.getByRole("searchbox", { name: "Search this list" }), { target: { value: "yena" } })
    expect(titles(openList())).toEqual(["Catch Catch"])
    fireEvent.change(screen.getByRole("searchbox", { name: "Search this list" }), { target: { value: "" } })
    fireEvent.click(screen.getByRole("button", { name: "Has flags" }))
    expect(titles(openList())).toEqual(["Im Sorry Mom"])
    fireEvent.click(screen.getByRole("button", { name: "All" }))
    fireEvent.click(screen.getByRole("button", { name: "KO" }))
    expect(titles(openList())).toEqual(["Catch Catch"])
    fireEvent.click(screen.getByRole("button", { name: "All" }))
    fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), { target: { value: "waiting" } })
    expect(titles(openList())).toEqual(["Im Sorry Mom", "Catch Catch", "Run Rabbit"])
  })

  it("combines the flag filter with several languages, and All clears them", async () => {
    stubCouncilApi(busy())
    renderCouncil("/council/queue")
    await waitFor(() => expect(titles(openList())).toHaveLength(3))
    const chip = (name: string) => screen.getByRole("button", { name })
    fireEvent.click(chip("No flags"))
    fireEvent.click(chip("KO"))
    expect(titles(openList())).toEqual(["Catch Catch"])
    fireEvent.click(chip("EN"))
    expect(titles(openList())).toEqual(["Catch Catch", "Run Rabbit"])
    expect(chip("KO").getAttribute("aria-pressed")).toBe("true")
    expect(chip("EN").getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(chip("Has flags"))
    expect(chip("No flags").getAttribute("aria-pressed")).toBe("false")
    expect(titles(openList())).toEqual(["Im Sorry Mom"])
    fireEvent.click(chip("All"))
    expect(chip("All").getAttribute("aria-pressed")).toBe("true")
    expect(titles(openList())).toHaveLength(3)
  })

  it("shows only the candidates with no automatic flags", async () => {
    stubCouncilApi(busy())
    renderCouncil("/council/queue")
    await waitFor(() => expect(titles(openList())).toHaveLength(3))
    fireEvent.click(screen.getByRole("button", { name: "No flags" }))
    expect(titles(openList())).toEqual(["Catch Catch", "Run Rabbit"])
  })

  it("focuses the search with the slash key", async () => {
    stubCouncilApi(busy())
    renderCouncil("/council/queue")
    await waitFor(() => expect(titles(openList())).toHaveLength(3))
    press("/")
    expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: "Search this list" }))
  })

  it("says the queue is clear when there is nothing to review", async () => {
    stubCouncilApi(councilData())
    renderCouncil("/council/queue")
    await screen.findByText("The seal queue is clear")
  })
})

describe("CouncilQueuePage song link", () => {
  const LINK = "https://music.youtube.com/watch?v=Lnk0000001A&si=x"
  function linked() {
    const inQueue = queueItem({ id: 50, videoId: "Lnk0000001A", song: "Linked Song" })
    const outside = queueItem({ id: 51, videoId: "Lnk0000001A", song: "Linked Song", score: 0.3 })
    return councilData({
      queue: [inQueue, queueItem({ id: 60, videoId: "Other000001", song: "Other Song" })],
      sealable: { Lnk0000001A: [inQueue, outside] },
    })
  }
  const search = (value: string) =>
    fireEvent.change(screen.getByRole("searchbox", { name: "Search this list" }), { target: { value } })

  it("lists every sealable variant of a pasted song, marking the ones outside the queue", async () => {
    stubCouncilApi(linked())
    renderCouncil("/council/queue")
    await waitFor(() => expect(titles(openList())).toHaveLength(2))
    search(LINK)
    await waitFor(() => expect(titles(openList())).toEqual(["Linked Song", "Linked Song"]))
    const rows = within(openList()).getAllByRole("link")
    expect(rows[0].textContent).not.toContain("Not in the queue")
    expect(rows[1].textContent).toContain("Not in the queue")
    fireEvent.click(rows[1])
    await waitFor(() => expect(selected()).toBe("51"))
    expect(screen.getByRole("button", { name: /^Seal/ })).toBeTruthy()
  })

  it("regression: finds lyrics linked to the pasted song from another video", async () => {
    const queued = queueItem({ id: 80, videoId: "Home0000001", song: "Linked Home" })
    const outside = queueItem({ id: 81, videoId: "Home0000002", song: "Linked Away" })
    stubCouncilApi(
      councilData({
        queue: [queued, queueItem({ id: 60, videoId: "Other000001", song: "Other Song" })],
        sealable: { Lnk0000001A: [queued, outside] },
      }),
    )
    renderCouncil("/council/queue")
    await waitFor(() => expect(titles(openList())).toHaveLength(2))
    search(LINK)
    await waitFor(() => expect(titles(openList())).toEqual(["Linked Home", "Linked Away"]))
  })

  it("says so when no variant of the pasted song can be sealed", async () => {
    stubCouncilApi(councilData({ queue: [queueItem({ id: 60, videoId: "Other000001" })] }))
    renderCouncil("/council/queue")
    await waitFor(() => expect(titles(openList())).toHaveLength(1))
    search("Nope0000001")
    expect(await screen.findByText(/Nothing to seal for this song/)).toBeTruthy()
  })

  it("finds a pasted song while the queue itself is empty", async () => {
    stubCouncilApi(
      councilData({ sealable: { Lnk0000001A: [queueItem({ id: 70, videoId: "Lnk0000001A", song: "Lone Song" })] } }),
    )
    renderCouncil("/council/queue")
    await screen.findByText("The seal queue is clear")
    search(LINK)
    await waitFor(() => expect(titles(openList())).toEqual(["Lone Song"]))
  })
})

describe("CouncilQueuePage selection", () => {
  it("selects the first item, then moves with J and K through the visible order", async () => {
    stubCouncilApi(busy())
    renderCouncil("/council/queue")
    await waitFor(() => expect(selected()).toBe("722"))
    press("j")
    await waitFor(() => expect(selected()).toBe("406"))
    press("j")
    press("j")
    press("j")
    await waitFor(() => expect(selected()).toBe("1093"))
    press("k")
    await waitFor(() => expect(selected()).toBe("1320"))
  })

  it("opens the item named in the address", async () => {
    stubCouncilApi(busy())
    renderCouncil("/council/queue?item=1093")
    await waitFor(() => expect(selected()).toBe("1093"))
  })
})

describe("CouncilQueuePage bookmarks", () => {
  it("bookmarks an open candidate and moves it to my bookmarks", async () => {
    const data = busy()
    const router = stubCouncilApi(data, { admin: false }, [
      {
        match: (url, init) => url === "/committee/bookmarks" && init?.method === "POST",
        respond: () => {
          data.queue = data.queue.map((i) => (i.id === 1320 ? { ...i, bookmark: bookmarkBy(ME, 9) } : i))
          return jsonResponse({
            success: true,
            data: { ...bookmarkBy(ME, 9), itemType: "seal", itemId: 1320, lyricsId: 1320 },
          })
        },
      },
    ])
    renderCouncil("/council/queue")
    await waitFor(() => expect(titles(openList())).toHaveLength(3))
    fireEvent.click(screen.getByRole("button", { name: "Bookmark Run Rabbit" }))
    await waitFor(() =>
      expect(titles(screen.getByRole("list", { name: "Your bookmarks" }))).toEqual([
        "Story of a Warrior",
        "Run Rabbit",
      ]),
    )
    const post = router.calls.find((c) => c.init?.method === "POST")
    expect(JSON.parse(String(post?.init?.body))).toEqual({ itemType: "seal", itemId: 1320 })
  })

  it("releases my bookmark with the B key on the selected item", async () => {
    const data = busy()
    const router = stubCouncilApi(data, { admin: false }, [
      {
        match: (url, init) => url === "/committee/bookmarks/1" && init?.method === "DELETE",
        respond: () => {
          data.queue = data.queue.map((i) => (i.id === 722 ? { ...i, bookmark: null } : i))
          return jsonResponse({ success: true, data: null })
        },
      },
    ])
    renderCouncil("/council/queue")
    await waitFor(() => expect(selected()).toBe("722"))
    press("b")
    await waitFor(() => expect(screen.queryByRole("list", { name: "Your bookmarks" })).toBeNull())
    expect(router.calls.some((c) => c.url === "/committee/bookmarks/1")).toBe(true)
  })

  it("regression: a refetch already in flight does not undo a release", async () => {
    const data = busy()
    const stale = structuredClone(data.queue)
    let holdRefetch: ((r: Response) => void) | null = null
    let finishRelease: ((r: Response) => void) | null = null
    let hold = false
    stubCouncilApi(data, { admin: false }, [
      {
        match: (url, init) => (init?.method ?? "GET") === "GET" && url === "/committee/queue",
        respond: () => {
          if (!hold) return jsonResponse({ success: true, data: data.queue })
          hold = false
          return new Promise<Response>((resolve) => {
            holdRefetch = resolve
          })
        },
      },
      {
        match: (url, init) => url === "/committee/bookmarks/1" && init?.method === "DELETE",
        respond: () =>
          new Promise<Response>((resolve) => {
            finishRelease = resolve
          }),
      },
    ])
    const { client } = renderCouncil("/council/queue")
    await waitFor(() => expect(selected()).toBe("722"))
    hold = true
    act(() => void client.invalidateQueries({ queryKey: ["council", "queue"] }))
    await waitFor(() => expect(holdRefetch).not.toBeNull())
    press("b")
    await waitFor(() => expect(screen.queryByRole("list", { name: "Your bookmarks" })).toBeNull())
    await act(async () => holdRefetch?.(jsonResponse({ success: true, data: stale })))
    await waitFor(() => expect(client.getQueryState(["council", "queue"])?.fetchStatus).toBe("idle"))
    expect(screen.queryByRole("list", { name: "Your bookmarks" })).toBeNull()
    data.queue = data.queue.map((i) => (i.id === 722 ? { ...i, bookmark: null } : i))
    await act(async () => finishRelease?.(jsonResponse({ success: true, data: null })))
    await waitFor(() => expect(screen.queryByRole("list", { name: "Your bookmarks" })).toBeNull())
  })

  it("shows the server reason and rolls back when the bookmark fails", async () => {
    stubCouncilApi(busy(), { admin: false }, [
      {
        match: (url, init) => url === "/committee/bookmarks" && init?.method === "POST",
        respond: () =>
          jsonResponse(
            { success: false, error: "Bookmark limit reached", hint: "Release one or decide on it first." },
            409,
          ),
      },
    ])
    renderCouncil("/council/queue")
    await waitFor(() => expect(titles(openList())).toHaveLength(3))
    fireEvent.click(screen.getByRole("button", { name: "Bookmark Run Rabbit" }))
    await screen.findByText("Bookmark limit reached")
    expect(screen.getByText("Release one or decide on it first.")).toBeTruthy()
    expect(titles(openList())).toContain("Run Rabbit")
  })

  it("offers no bookmark button on another member's bookmark", async () => {
    stubCouncilApi(busy())
    renderCouncil("/council/queue")
    await waitFor(() => expect(titles(openList())).toHaveLength(3))
    fireEvent.click(screen.getByRole("button", { name: /Bookmarked by others/ }))
    expect(screen.queryByRole("button", { name: /Isn't She Lovely/ })).toBeNull()
  })
})

describe("CouncilQueuePage new items", () => {
  it("holds new candidates behind a pill until asked", async () => {
    const data = busy()
    stubCouncilApi(data)
    const { client } = renderCouncil("/council/queue")
    await waitFor(() => expect(titles(openList())).toHaveLength(3))
    data.queue = [...data.queue, queueItem({ id: 1883, song: "Superman (con Dina Rae)" })]
    await act(() => client.invalidateQueries({ queryKey: ["council", "queue"] }))
    const pill = await screen.findByRole("button", { name: "1 new candidate" })
    expect(titles(openList())).not.toContain("Superman (con Dina Rae)")
    fireEvent.click(pill)
    expect(titles(openList())).toContain("Superman (con Dina Rae)")
    expect(screen.queryByRole("button", { name: /new candidate/ })).toBeNull()
  })
})

describe("CouncilQueuePage auto advance", () => {
  it("remembers the auto advance setting", async () => {
    stubCouncilApi(busy())
    renderCouncil("/council/queue")
    const toggle = await screen.findByRole("switch", { name: "Open the next item after a decision" })
    expect((toggle as HTMLInputElement).checked).toBe(true)
    fireEvent.click(toggle)
    expect(localStorage.getItem("council.autoAdvance")).toBe("off")
  })
})
