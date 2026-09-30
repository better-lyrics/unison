import { __resetToastStore } from "@/lib/toast"
import {
  ME,
  NOW,
  OLA,
  councilData,
  councilEvent,
  overview,
  rosterMember,
  stubCouncilApi,
} from "@/test/council-fixtures"
import { jsonResponse } from "@/test/fetch-router"
import { renderCouncil } from "@/test/render-council"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
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

const me = { ...ME, tier: undefined }
const ola = { ...OLA, tier: undefined }

function data() {
  return councilData({
    events: {
      events: [
        councilEvent({ id: 5, kind: "seal", actor: me, at: NOW - HOUR, source: "web" }),
        councilEvent({
          id: 4,
          kind: "reject",
          actor: ola,
          at: NOW - 2 * HOUR,
          source: "discord",
          note: "Background vocals are merged into the lead line.",
          lyric: { id: 12, videoId: "p3r0yVv0lQs", song: "Sleep Well", artist: "CG5" },
        }),
        councilEvent({ id: 3, kind: "seal", actor: ola, at: NOW - 30 * HOUR, undone: true }),
        councilEvent({ id: 2, kind: "reject", actor: me, at: NOW - 5 * DAY }),
      ],
      nextCursor: "1790000000:2",
    },
    members: [
      rosterMember(ME, { lastWeek: { sealed: 1, rejected: 2, edits: 0 } }),
      rosterMember(OLA, { lastWeek: { sealed: 2, rejected: 3, edits: 4 } }),
    ],
    overview: overview({ sourceSplit: { web: 31, discord: 19 } }),
  })
}

const calls = (router: ReturnType<typeof stubCouncilApi>) =>
  router.calls.map((c) => c.url).filter((u) => u.startsWith("/committee/events"))

describe("CouncilActivityPage", () => {
  it("groups decisions by day with source, note and undone state", async () => {
    stubCouncilApi(data())
    renderCouncil("/council/activity")
    const today = await screen.findByRole("region", { name: "Today" })
    const items = within(today).getAllByRole("listitem")
    expect(items[0].textContent).toContain("boidu sealed Story of a Warrior by John Michael Howell")
    expect(items[0].textContent).toContain("Web")
    expect(items[1].textContent).toContain("Discord")
    expect(items[1].textContent).toContain("Background vocals are merged into the lead line.")
    expect(within(items[1]).getByRole("link", { name: "Sleep Well" }).getAttribute("href")).toBe("/song/p3r0yVv0lQs")
    expect(screen.getByText("Undone")).toBeTruthy()
  })

  it("offers undo only on my own recent seal or rejection and runs it", async () => {
    const log: string[] = []
    stubCouncilApi(data(), { admin: false }, [
      {
        match: (url, init) => init?.method === "DELETE" && /^\/lyrics\/\d+\/boost$/.test(url),
        respond: (url) => {
          log.push(url)
          return jsonResponse({ success: true, data: null })
        },
      },
    ])
    renderCouncil("/council/activity")
    await screen.findByRole("region", { name: "Today" })
    const undo = screen.getAllByRole("button", { name: "Undo" })
    expect(undo).toHaveLength(1)
    fireEvent.click(undo[0])
    await waitFor(() => expect(log).toEqual(["/lyrics/722/boost"]))
    await screen.findByText("Seal lifted from “Story of a Warrior”")
  })

  it("undoes my own rejection by the rejection it recorded, and hides undo once it lapsed", async () => {
    const log: string[] = []
    stubCouncilApi(
      councilData({
        events: {
          events: [
            councilEvent({ id: 7, kind: "reject", actor: me, at: NOW - HOUR, refId: 91 }),
            councilEvent({
              id: 6,
              kind: "reject",
              actor: me,
              at: NOW - 2 * HOUR,
              refId: 90,
              active: false,
              lyric: { id: 12, videoId: "p3r0yVv0lQs", song: "Sleep Well", artist: "CG5" },
            }),
          ],
          nextCursor: null,
        },
      }),
      { admin: false },
      [
        {
          match: (url, init) => init?.method === "DELETE" && url.startsWith("/lyrics/722/reject"),
          respond: (url) => {
            log.push(url)
            return jsonResponse({ success: true, data: null })
          },
        },
      ],
    )
    renderCouncil("/council/activity")
    await screen.findByRole("region", { name: "Today" })
    const undo = screen.getAllByRole("button", { name: "Undo" })
    expect(undo).toHaveLength(1)
    fireEvent.click(undo[0])
    await waitFor(() => expect(log).toEqual(["/lyrics/722/reject?rejection=91"]))
  })

  it("filters by kind, member and bookmarks through the server", async () => {
    const router = stubCouncilApi(data())
    renderCouncil("/council/activity")
    await screen.findByRole("region", { name: "Today" })
    fireEvent.click(screen.getByRole("button", { name: "Rejections" }))
    await waitFor(() => expect(calls(router)).toContain("/committee/events?kind=rejections"))
    fireEvent.change(screen.getByRole("combobox", { name: "Member" }), { target: { value: OLA.keyId } })
    await waitFor(() => expect(calls(router)).toContain(`/committee/events?kind=rejections&actor=${OLA.keyId}`))
    fireEvent.click(screen.getByRole("switch", { name: "Include bookmarks" }))
    await waitFor(() =>
      expect(calls(router)).toContain(`/committee/events?kind=rejections&actor=${OLA.keyId}&includeBookmarks=1`),
    )
  })

  it("opens on the filters in the address", async () => {
    const router = stubCouncilApi(data())
    renderCouncil(`/council/activity?kind=seals&actor=${OLA.keyId}`)
    await waitFor(() => expect(calls(router)).toContain(`/committee/events?kind=seals&actor=${OLA.keyId}`))
    expect(screen.getByRole("button", { name: "Seals" }).getAttribute("aria-pressed")).toBe("true")
  })

  it("ignores an unknown kind in the address", async () => {
    const router = stubCouncilApi(data())
    renderCouncil("/council/activity?kind=bogus")
    await waitFor(() => expect(calls(router)).toContain("/committee/events"))
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true")
  })

  it("loads older activity with the cursor", async () => {
    const router = stubCouncilApi(data(), { admin: false }, [
      {
        match: (url) => url.startsWith("/committee/events?cursor="),
        respond: () =>
          jsonResponse({
            success: true,
            data: { events: [councilEvent({ id: 1, at: NOW - 9 * DAY, actor: ola })], nextCursor: null },
          }),
      },
    ])
    renderCouncil("/council/activity")
    fireEvent.click(await screen.findByRole("button", { name: "Load older activity" }))
    await waitFor(() => expect(calls(router)).toContain("/committee/events?cursor=1790000000%3A2"))
    await waitFor(() => expect(screen.queryByRole("button", { name: "Load older activity" })).toBeNull())
    expect(screen.getAllByRole("listitem").filter((li) => li.textContent?.includes("olafix52 sealed")).length).toBe(2)
  })

  it("shows each member's week and filters to a member from the chart", async () => {
    const router = stubCouncilApi(data())
    renderCouncil("/council/activity")
    const week = await screen.findByRole("list", { name: "Decisions per member" })
    const rows = within(week).getAllByRole("button")
    expect(rows.map((r) => r.textContent)).toEqual(["olafix529", "boidu3"])
    fireEvent.click(rows[0])
    await waitFor(() => expect(calls(router)).toContain(`/committee/events?actor=${OLA.keyId}`))
    expect(rows[0].getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByText("62%")).toBeTruthy()
    expect(screen.getByText("38%")).toBeTruthy()
  })

  it("says so when nothing matches", async () => {
    stubCouncilApi(councilData())
    renderCouncil("/council/activity")
    await screen.findByText("No activity matches")
  })
})
