import {
  ME,
  NOW,
  OLA,
  applicant,
  bookmarkBy,
  councilData,
  councilEvent,
  dayDecisions,
  editItem,
  overview,
  queueItem,
  stubCouncilApi,
} from "@/test/council-fixtures"
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
})

const busy = () =>
  councilData({
    queue: [
      queueItem({ id: 1, createdAt: NOW - 2 * DAY }),
      queueItem({ id: 2, createdAt: NOW - 20 * DAY, song: "Dream Sweet in Sea Major" }),
      queueItem({ id: 3, createdAt: NOW - 3 * HOUR, bookmark: bookmarkBy(ME) }),
    ],
    edits: {
      items: [editItem({ revisionId: 9001, pendingReason: "sealed", createdAt: NOW - 2 * DAY - 6 * HOUR })],
      thresholds: { textDrift: 0.15, timingDrift: 0.3, jevFlag: 0.7 },
    },
    applicants: [applicant()],
    overview: overview({
      decisionsByDay: dayDecisions([
        [1, 2, 0],
        [0, 1, 3],
      ]),
      medianDecisionHours: { current: 19.4, previous: 31 },
      sealRate: 0.27,
    }),
    events: {
      events: Array.from({ length: 8 }, (_, i) => councilEvent({ id: i + 1, at: NOW - (i + 1) * HOUR })),
      nextCursor: "x",
    },
  })

const main = () => screen.getByTestId("council-overview")

describe("CouncilOverviewPage", () => {
  it("summarises the open work under the title", async () => {
    stubCouncilApi(busy())
    renderCouncil()
    await screen.findByRole("heading", { level: 1, name: "Council" })
    await waitFor(() => expect(main().textContent).toContain("2 open candidates, 1 edit, 1 applicant"))
  })

  it("starts reviewing in the seal queue", async () => {
    stubCouncilApi(busy())
    renderCouncil()
    const start = await screen.findByRole("link", { name: /Start reviewing/ })
    expect(start.getAttribute("href")).toBe("/council/queue")
  })

  it("shows the four headline numbers", async () => {
    stubCouncilApi(busy())
    renderCouncil()
    const tile = async (label: string) => (await screen.findByText(label)).parentElement?.textContent
    await waitFor(async () => expect(await tile("Open in seal queue")).toContain("2candidates"))
    expect(await tile("Open in seal queue")).toContain("1 new this week")
    expect(await tile("Edits waiting")).toContain("1pending")
    expect(await tile("Edits waiting")).toContain("Oldest 2d")
    await waitFor(async () => expect(await tile("Median time to decision")).toContain("19hours"))
    expect(await tile("Median time to decision")).toContain("31h the 30 days before")
    expect(await tile("Seal rate this month")).toContain("27%of decisions")
  })

  it("lists what needs me with links to the item", async () => {
    stubCouncilApi(busy())
    renderCouncil()
    const needs = await screen.findByRole("region", { name: "Needs you" })
    await waitFor(() => expect(within(needs).getAllByRole("link")).toHaveLength(3))
    expect(within(needs).getAllByRole("link")[0].getAttribute("href")).toBe("/council/edits?item=9001")
  })

  it("shows the six latest council decisions and a link to the full log", async () => {
    const router = stubCouncilApi(busy())
    renderCouncil()
    const feed = await screen.findByRole("region", { name: "Council activity" })
    await waitFor(() => expect(within(feed).getAllByRole("listitem")).toHaveLength(6))
    expect(router.calls.filter((c) => c.url.startsWith("/committee/events")).map((c) => c.url)).toEqual([
      "/committee/events?limit=6",
    ])
    expect(within(feed).getAllByRole("listitem")[0].textContent).toBe("olafix52 sealed Story of a Warrior1h")
    expect(
      within(feed)
        .getByRole("link", { name: /See all/ })
        .getAttribute("href"),
    ).toBe("/council/activity")
  })

  it("switches the decisions chart to my own work", async () => {
    const data = busy()
    data.myOverview = overview({ decisionsByDay: dayDecisions([[0, 1, 0]]) })
    const router = stubCouncilApi(data)
    renderCouncil()
    const chart = await screen.findByRole("region", { name: "Decisions, last 30 days" })
    await waitFor(() =>
      expect(
        within(chart)
          .getAllByRole("listitem")
          .map((l) => l.textContent),
      ).toContain("Sealed1"),
    )
    fireEvent.click(within(chart).getByRole("button", { name: "You" }))
    await waitFor(() =>
      expect(
        within(chart)
          .getAllByRole("listitem")
          .map((l) => l.textContent),
      ).toContain("Sealed0"),
    )
    expect(router.calls.some((c) => c.url === "/committee/overview?scope=me")).toBe(true)
    expect(within(chart).getByRole("button", { name: "You" }).getAttribute("aria-pressed")).toBe("true")
  })

  it("buckets waiting items and names the oldest", async () => {
    stubCouncilApi(busy())
    renderCouncil()
    const chart = await screen.findByRole("region", { name: "How long items wait" })
    await waitFor(() => expect(chart.textContent).toContain("Oldest: Dream Sweet in Sea Major, waiting 3w."))
    expect(within(chart).getByRole("img", { name: /waiting time/ })).toBeTruthy()
  })

  it("shows my month in pills", async () => {
    stubCouncilApi(busy())
    renderCouncil()
    const month = await screen.findByRole("region", { name: /^Your / })
    await waitFor(() => expect(month.textContent).toContain("seals used"))
    expect(month.textContent).toContain("rejections")
    expect(month.textContent).toContain("edits reviewed")
    expect(month.textContent).toContain("your median decision time")
  })

  describe("edge cases", () => {
    it("is all caught up when nothing needs me", async () => {
      stubCouncilApi(councilData())
      renderCouncil()
      const needs = await screen.findByRole("region", { name: "Needs you" })
      await waitFor(() => expect(within(needs).getByText("All caught up")).toBeTruthy())
    })

    it("says nothing is waiting on an empty queue", async () => {
      stubCouncilApi(councilData())
      renderCouncil()
      const chart = await screen.findByRole("region", { name: "How long items wait" })
      await waitFor(() => expect(chart.textContent).toContain("Nothing is waiting."))
    })

    it("shows no numbers yet for a council with no decisions", async () => {
      stubCouncilApi(
        councilData({
          overview: overview({ medianDecisionHours: { current: null, previous: null }, sealRate: null }),
        }),
      )
      renderCouncil()
      const tile = async (label: string) => (await screen.findByText(label)).parentElement?.textContent
      await waitFor(async () => expect(await tile("Median time to decision")).toContain("No decisions yet"))
      expect(await tile("Seal rate this month")).toContain("No decisions yet")
      expect(await tile("Edits waiting")).toContain("Nothing waiting")
    })

    it("hides the median pill when I have no decisions", async () => {
      const data = councilData()
      data.overview.me.medianDecisionHours = null
      stubCouncilApi(data)
      renderCouncil()
      const month = await screen.findByRole("region", { name: /^Your / })
      await waitFor(() => expect(month.textContent).toContain("seals used"))
      expect(month.textContent).not.toContain("median")
    })

    it("uses the other member's name in the feed", async () => {
      stubCouncilApi(
        councilData({
          events: {
            events: [councilEvent({ kind: "member_add", actor: null, lyric: null, subject: { ...OLA } })],
            nextCursor: null,
          },
        }),
      )
      renderCouncil()
      const feed = await screen.findByRole("region", { name: "Council activity" })
      await waitFor(() =>
        expect(within(feed).getByRole("listitem").textContent).toContain("An admin added olafix52 to the council"),
      )
    })
  })
})
