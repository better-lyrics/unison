import { __resetToastStore } from "@/lib/toast"
import { ME, NOW, OLA, bookmarkBy, councilData, editItem, queueItem, stubCouncilApi } from "@/test/council-fixtures"
import { jsonResponse } from "@/test/fetch-router"
import { renderCouncil } from "@/test/render-council"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@braccato/core/element", () => ({}))

const HOUR = 3600

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

const later = { ...bookmarkBy(ME, 1), expiresAt: NOW + 60 * HOUR }
const sooner = { ...bookmarkBy(ME, 2), expiresAt: NOW + 5 * HOUR }

function data() {
  return councilData({
    queue: [
      queueItem({ id: 722, song: "Story of a Warrior", bookmark: later }),
      queueItem({ id: 1320, song: "Run Rabbit" }),
      queueItem({ id: 406, song: "Catch Catch", bookmark: bookmarkBy(OLA, 3) }),
    ],
    edits: {
      items: [editItem({ revisionId: 9004, song: "Alone", bookmark: sooner })],
      thresholds: { textDrift: 0.15, timingDrift: 0.3, jevFlag: 0.7 },
    },
  })
}

const list = () => screen.getByRole("list", { name: "Your bookmarks" })
const titles = () =>
  within(list())
    .getAllByRole("link")
    .map((l) => l.querySelector(".truncate")?.textContent)

describe("CouncilBookmarksPage", () => {
  it("lists only my bookmarks across the queue and edits, the one expiring first on top", async () => {
    stubCouncilApi(data(), { admin: false }, [
      {
        match: (url) => /\/revisions/.test(url),
        respond: () => jsonResponse({ success: true, data: { rows: [], againstRevNo: null, revisions: [] } }),
      },
    ])
    renderCouncil("/council/bookmarks")
    await waitFor(() => expect(titles()).toEqual(["Alone", "Story of a Warrior"]))
    expect(screen.getByText(/goes back to the open queue 3 days after you bookmark it/)).toBeTruthy()
    expect(screen.getByText(/You can hold 5 at a time/)).toBeTruthy()
  })

  it("opens the right detail for a lyric and for an edit", async () => {
    stubCouncilApi(data(), { admin: false }, [
      {
        match: (url) => /\/revisions/.test(url),
        respond: () => jsonResponse({ success: true, data: { rows: [], againstRevNo: null, revisions: [] } }),
      },
    ])
    renderCouncil("/council/bookmarks")
    const detail = () => screen.getByRole("region", { name: "Details" })
    await waitFor(() => expect(detail().textContent).toContain("Why this needs you."))
    fireEvent.click(within(list()).getByRole("link", { name: /Story of a Warrior/ }))
    await waitFor(() => expect(detail().textContent).toContain("Automatic checks"))
  })

  it("shows how to bookmark when I hold nothing", async () => {
    stubCouncilApi(councilData({ queue: [queueItem({ bookmark: bookmarkBy(OLA) })] }))
    renderCouncil("/council/bookmarks")
    await screen.findByText("No bookmarks")
    expect(screen.getByText(/Press B on any queue item to hold it for 3 days/)).toBeTruthy()
    expect(screen.queryByRole("region", { name: "Details" })).toBeNull()
  })

  describe("regressions", () => {
    it("leaves / to the site search, since this page has no search box", async () => {
      stubCouncilApi(data(), { admin: false }, [
        {
          match: (url) => /\/revisions/.test(url),
          respond: () => jsonResponse({ success: true, data: { rows: [], againstRevNo: null, revisions: [] } }),
        },
      ])
      renderCouncil("/council/bookmarks")
      await waitFor(() => expect(titles()).toHaveLength(2))
      const event = new KeyboardEvent("keydown", { key: "/", cancelable: true })
      window.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    })
  })
})
