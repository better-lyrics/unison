import { lyricsKeys } from "@/hooks/useLyricsData"
import type { DiffRow, RevisionSummary } from "@/lib/revision-types"
import { __resetToastStore } from "@/lib/toast"
import { NOW, OLA, bookmarkBy, councilData, editItem, stubCouncilApi } from "@/test/council-fixtures"
import { jsonResponse } from "@/test/fetch-router"
import { renderCouncil } from "@/test/render-council"
import { QueryObserver } from "@tanstack/react-query"
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

const sealedEdit = editItem({
  lyricsId: 669,
  revisionId: 9001,
  revNo: 4,
  liveRevNo: 3,
  song: "Isn't She Lovely",
  pendingReason: "sealed",
  textDrift: 0.04,
  timingDrift: 0.11,
  jevProbability: null,
  createdAt: NOW - 2 * DAY,
})
const driftEdit = editItem({
  lyricsId: 612,
  revisionId: 9003,
  revNo: 5,
  liveRevNo: 4,
  videoId: "vXc5jYyfRqY",
  song: "One More Hour",
  artist: "Tame Impala",
  pendingReason: "large_text_drift",
  textDrift: 0.23,
  createdAt: NOW - 20 * HOUR,
  bookmark: bookmarkBy(OLA, 4),
})

const DIFF: DiffRow[] = [
  {
    kind: "word",
    lineNo: 4,
    startMs: 21180,
    parts: [
      ["=", "I kept the "],
      ["-", "maps"],
      ["+", "map"],
    ],
  },
]

const HISTORY: RevisionSummary[] = [
  {
    id: 9001,
    revNo: 4,
    status: "pending",
    pendingReason: "sealed",
    isAnchor: false,
    textDrift: 0.04,
    timingDrift: 0.11,
    revertsRevNo: null,
    author: { displayName: "Yes" },
    reviewNote: null,
    createdAt: NOW - 2 * DAY,
    reviewedAt: null,
  },
  {
    id: 8001,
    revNo: 3,
    status: "live",
    pendingReason: null,
    isAnchor: false,
    textDrift: 0,
    timingDrift: 0,
    revertsRevNo: null,
    author: { displayName: "Yes" },
    reviewNote: null,
    createdAt: NOW - 41 * DAY,
    reviewedAt: NOW - 41 * DAY,
  },
]

function routes(log: string[]) {
  return [
    {
      match: (url: string) => /^\/lyrics\/\d+\/revisions\/\d+\/diff$/.test(url),
      respond: () => jsonResponse({ success: true, data: { rows: DIFF, againstRevNo: 3 } }),
    },
    {
      match: (url: string, init?: RequestInit) =>
        (init?.method ?? "GET") === "GET" && /^\/lyrics\/\d+\/revisions$/.test(url),
      respond: () => jsonResponse({ success: true, data: { revisions: HISTORY } }),
    },
    {
      match: (url: string, init?: RequestInit) =>
        init?.method === "POST" && /\/revisions\/\d+\/(approve|reject)$/.test(url),
      respond: (url: string, init?: RequestInit) => {
        log.push(`${url} ${init?.body ?? ""}`.trim())
        return jsonResponse({ success: true, data: null })
      },
    },
  ]
}

function data() {
  return councilData({
    edits: { items: [sealedEdit, driftEdit], thresholds: { textDrift: 0.15, timingDrift: 0.3, jevFlag: 0.7 } },
  })
}

const detail = () => screen.getByRole("region", { name: "Details" })
const selected = () => document.querySelector("[aria-current='true'][data-key]")?.getAttribute("data-key")

describe("CouncilEditsPage", () => {
  it("lists open edits oldest first and keeps other members' bookmarks aside", async () => {
    stubCouncilApi(data(), { admin: false }, routes([]))
    renderCouncil("/council/edits")
    const open = await screen.findByRole("list", { name: "Open edits" })
    await waitFor(() => expect(within(open).getAllByRole("link")).toHaveLength(1))
    expect(within(open).getByRole("link").textContent).toContain("Rev 4")
    expect(within(open).getByRole("link").textContent).toContain("sealed")
    expect(screen.getByRole("button", { name: /Bookmarked by others/ })).toBeTruthy()
  })

  it("explains why the edit needs the council and shows the drift against thresholds", async () => {
    stubCouncilApi(data(), { admin: false }, routes([]))
    renderCouncil("/council/edits?item=9001")
    await waitFor(() => expect(detail().textContent).toContain("Why this needs you."))
    expect(detail().textContent).toContain("This lyric carries the council seal")
    expect(detail().textContent).toContain("Rev 4 replaces Rev 3")
    const meters = within(detail()).getAllByRole("meter")
    expect(meters.map((m) => m.getAttribute("aria-label"))).toEqual(["Text drift", "Timing drift", "Jev flag"])
    expect(meters[0].getAttribute("aria-valuenow")).toBe("4")
    expect(meters[2].hasAttribute("aria-valuenow")).toBe(false)
    expect(detail().textContent).toContain("Not scored")
    expect(detail().textContent).toContain("Review threshold 15%")
  })

  it("shows the word changes and switches to a split view", async () => {
    stubCouncilApi(data(), { admin: false }, routes([]))
    renderCouncil("/council/edits?item=9001")
    await waitFor(() => expect(detail().querySelector("[data-row='del'] mark")?.textContent).toBe("maps"))
    fireEvent.click(within(detail()).getByRole("button", { name: "Split" }))
    expect(detail().querySelector("[data-side='after'] mark")?.textContent).toBe("map")
  })

  it("shows the author's real badges", async () => {
    const d = data()
    d.edits.items[0] = {
      ...d.edits.items[0],
      author: d.edits.items[0].author && {
        ...d.edits.items[0].author,
        tier: "master",
        featured: [{ key: "prolific", name: "Prolific" }],
        badgeCount: 2,
      },
    }
    stubCouncilApi(d, { admin: false }, routes([]))
    renderCouncil("/council/edits?item=9001")
    expect(
      await within(await screen.findByRole("region", { name: "Details" })).findByRole("img", { name: "Prolific" }),
    ).toBeTruthy()
    await waitFor(() => expect(detail().querySelector("[data-tier='master'] img")).toBeTruthy())
  })

  it("shows the author first, above the drift and the changes", async () => {
    stubCouncilApi(data(), { admin: false }, routes([]))
    renderCouncil("/council/edits?item=9001")
    const author = await within(await screen.findByRole("region", { name: "Details" })).findByText("Author")
    const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(follows(author, within(detail()).getByText("Text drift"))).toBe(true)
    expect(follows(author, within(detail()).getByText("Changes"))).toBe(true)
  })

  it("lists the revision history newest first", async () => {
    stubCouncilApi(data(), { admin: false }, routes([]))
    renderCouncil("/council/edits?item=9001")
    await waitFor(() => expect(detail().textContent).toContain("Rev 4 submitted by Yes2d"))
    expect(detail().textContent).toContain("Rev 3 is live, written by Yes")
  })

  it("approves after confirmation with A, then Enter, and opens the next edit", async () => {
    const log: string[] = []
    stubCouncilApi(data(), { admin: false }, routes(log))
    renderCouncil("/council/edits?item=9001")
    await waitFor(() => expect(within(detail()).getByRole("button", { name: /^Approve/ })).toBeTruthy())
    act(() => void fireEvent.keyDown(window, { key: "a" }))
    expect(detail().textContent).toContain("Approve Rev 4?")
    expect(detail().textContent).toContain("It replaces Rev 3 for every listener right away.")
    act(() => void fireEvent.keyDown(window, { key: "Enter" }))
    await waitFor(() => expect(log).toEqual(["/lyrics/669/revisions/9001/approve {}"]))
    await screen.findByText("Approved the edit to “Isn't She Lovely”")
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull()
  })

  it("refetches the lyric's cached versions after a decision", async () => {
    const log: string[] = []
    stubCouncilApi(data(), { admin: false }, routes(log))
    const { client } = renderCouncil("/council/edits?item=9001")
    const keys = [lyricsKeys.variants("oE56g61mW44"), lyricsKeys.variant(669), lyricsKeys.revisions(669)]
    const stops = keys.map((queryKey) =>
      new QueryObserver(client, { queryKey, queryFn: () => null, staleTime: Number.POSITIVE_INFINITY }).subscribe(
        () => {},
      ),
    )
    const updates = () => keys.map((k) => client.getQueryState(k)?.dataUpdateCount ?? 0)
    await waitFor(() => expect(within(detail()).getByRole("button", { name: /^Approve/ })).toBeTruthy())
    await waitFor(() => expect(updates().every((n) => n > 0)).toBe(true))
    const before = updates()
    act(() => void fireEvent.keyDown(window, { key: "a" }))
    act(() => void fireEvent.keyDown(window, { key: "Enter" }))
    await waitFor(() => expect(log).toHaveLength(1))
    await waitFor(() => expect(updates().map((n, i) => n > before[i])).toEqual([true, true, true]))
    for (const stop of stops) stop()
  })

  it("rejects an edit with a note for the author", async () => {
    const log: string[] = []
    stubCouncilApi(data(), { admin: false }, routes(log))
    renderCouncil("/council/edits?item=9001")
    await waitFor(() => expect(selected()).toBe("9001"))
    fireEvent.click(within(detail()).getByRole("button", { name: /^Reject/ }))
    expect(detail().textContent).toContain("The author sees it with the rejected edit.")
    fireEvent.change(within(detail()).getByRole("textbox"), { target: { value: "Keep the translations." } })
    fireEvent.click(within(detail()).getByRole("button", { name: /Reject edit/ }))
    await waitFor(() => expect(log).toEqual([`/lyrics/669/revisions/9001/reject {"note":"Keep the translations."}`]))
  })

  it("says so when no edits wait", async () => {
    stubCouncilApi(councilData(), { admin: false }, routes([]))
    renderCouncil("/council/edits")
    await screen.findByText("No edits waiting")
  })
})
