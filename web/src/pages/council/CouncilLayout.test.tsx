import { saveStoredSession } from "@/lib/auth"
import {
  ME,
  MEMBER_SESSION,
  NOW,
  OLA,
  applicant,
  bookmarkBy,
  councilData,
  editItem,
  queueItem,
  rosterMember,
  stubCouncilApi,
} from "@/test/council-fixtures"
import { fetchRouter, jsonResponse } from "@/test/fetch-router"
import { renderCouncil as renderWithRoutes } from "@/test/render-council"
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { useLocation } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

const probes = ["", "queue", "edits", "bookmarks", "applicants", "activity", "members"].map((p) =>
  p === "" ? { index: true, element: <Where /> } : { path: p, element: <Where /> },
)

const renderCouncil = (path?: string) => renderWithRoutes(path, probes)

const rail = () => screen.getByRole("navigation", { name: "Council sections" })

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

describe("CouncilLayout gate", () => {
  it("asks a signed-out visitor to sign in and fetches no council data", async () => {
    const router = fetchRouter([])
    vi.stubGlobal("fetch", router.fn)
    renderCouncil()
    await screen.findByText("Not signed in")
    expect(screen.queryByRole("navigation", { name: "Council sections" })).toBeNull()
    expect(router.calls.filter((c) => c.url.startsWith("/committee"))).toEqual([])
  })

  it("tells a signed-in non-member the dashboard is for the council", async () => {
    const router = stubCouncilApi(councilData(), null)
    renderCouncil()
    await screen.findByText("Council members only")
    expect(router.calls.map((c) => c.url).filter((url) => url !== "/badges")).toEqual(["/auth/me"])
  })

  it("shows a busy skeleton while the session loads", async () => {
    saveStoredSession(MEMBER_SESSION)
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    )
    renderCouncil()
    expect(document.querySelector("[aria-busy='true']")).not.toBeNull()
    expect(screen.queryByText("Council members only")).toBeNull()
  })
})

describe("CouncilLayout rail", () => {
  it("lists every section and marks the current one", async () => {
    stubCouncilApi()
    renderCouncil("/council/edits")
    const nav = await waitFor(rail)
    expect(
      within(nav)
        .getAllByRole("link")
        .map((l) => l.getAttribute("href")),
    ).toEqual([
      "/council",
      "/council/queue",
      "/council/edits",
      "/council/bookmarks",
      "/council/applicants",
      "/council/activity",
      "/council/members",
    ])
    expect(within(nav).getByRole("link", { current: "page" }).textContent).toContain("Edits")
  })

  it("counts open queue items, edits, my bookmarks, pending applicants and members", async () => {
    stubCouncilApi(
      councilData({
        queue: [
          queueItem({ id: 1 }),
          queueItem({ id: 2 }),
          queueItem({ id: 3, bookmark: bookmarkBy(ME) }),
          queueItem({ id: 4, bookmark: bookmarkBy(OLA, 2) }),
        ],
        edits: {
          items: [editItem({ revisionId: 1, bookmark: bookmarkBy(ME, 3) }), editItem({ revisionId: 2 })],
          thresholds: { textDrift: 0.15, timingDrift: 0.3, jevFlag: 0.7 },
        },
        applicants: [applicant(), applicant({ applicantId: 70, state: "failed" })],
        members: [rosterMember(ME), rosterMember(OLA), rosterMember({ ...OLA, userId: 3, keyId: "0c".repeat(32) })],
      }),
    )
    renderCouncil()
    const count = (name: string) =>
      within(rail())
        .getByRole("link", { name: new RegExp(name) })
        .querySelector("[data-count]")?.textContent
    await waitFor(() => expect(count("Seal queue")).toBe("2"))
    expect(count("Edits")).toBe("2")
    await waitFor(() => expect(count("Bookmarks")).toBe("2/5"))
    await waitFor(() => expect(count("Applicants")).toBe("1"))
    await waitFor(() => expect(count("Members")).toBe("3"))
    expect(
      within(rail())
        .getByRole("link", { name: /Overview/ })
        .querySelector("[data-count]"),
    ).toBeNull()
  })

  it("highlights the edits count when a sealed lyric waits for approval", async () => {
    stubCouncilApi(
      councilData({
        edits: {
          items: [editItem({ pendingReason: "sealed" })],
          thresholds: { textDrift: 0.15, timingDrift: 0.3, jevFlag: 0.7 },
        },
      }),
    )
    renderCouncil()
    await waitFor(() =>
      expect(
        within(rail()).getByRole("link", { name: /Edits/ }).querySelector("[data-count]")?.getAttribute("data-hot"),
      ).toBe("true"),
    )
  })

  it("shows the seals left this month, my tier and the reset day", async () => {
    stubCouncilApi()
    renderCouncil()
    await screen.findByText("seals left", { exact: false })
    const card = screen.getByTestId("quota-card")
    expect(card.textContent).toContain("2 of 3 seals left")
    expect(card.textContent).toContain("Elite quota · resets Oct 1")
  })

  describe("edge cases", () => {
    it("regression: counts an item whose bookmark ran out as open", async () => {
      stubCouncilApi(
        councilData({
          queue: [queueItem({ id: 1, bookmark: { ...bookmarkBy(OLA), expiresAt: Math.floor(Date.now() / 1000) - 1 } })],
        }),
      )
      renderCouncil()
      await waitFor(() =>
        expect(
          within(rail())
            .getByRole("link", { name: /Seal queue/ })
            .querySelector("[data-count]")?.textContent,
        ).toBe("1"),
      )
    })

    it("renders no counts before the data arrives", async () => {
      saveStoredSession(MEMBER_SESSION)
      vi.stubGlobal(
        "fetch",
        fetchRouter([
          {
            match: (url) => url === "/auth/me",
            respond: () =>
              jsonResponse({
                success: true,
                data: { keyId: ME.keyId, displayName: ME.displayName, expiresAt: 9e9, council: { admin: false } },
              }),
          },
          { match: () => true, respond: () => new Promise<Response>(() => {}) },
        ]).fn,
      )
      renderCouncil()
      await waitFor(rail)
      expect(rail().querySelectorAll("[data-count]")).toHaveLength(0)
      expect(screen.queryByTestId("quota-card")).toBeNull()
    })

    it("says no seals left at a spent quota", async () => {
      const data = councilData()
      data.overview.me.quota = { ...data.overview.me.quota, used: 3, remaining: 0 }
      stubCouncilApi(data)
      renderCouncil()
      await waitFor(() => expect(screen.getByTestId("quota-card").textContent).toContain("0 of 3 seals left"))
    })
  })
})

describe("CouncilLayout shortcuts", () => {
  it("goes to a section with a G chord", async () => {
    stubCouncilApi()
    renderCouncil("/council/members")
    await waitFor(rail)
    const press = (key: string) => act(() => void fireEvent.keyDown(window, { key }))
    press("g")
    press("q")
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/council/queue"))
    press("g")
    press("o")
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/council"))
    press("g")
    press("e")
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/council/edits"))
    press("g")
    press("a")
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/council/activity"))
  })
})
