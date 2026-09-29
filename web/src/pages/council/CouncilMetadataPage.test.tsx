import { __resetToastStore } from "@/lib/toast"
import { ME, NOW, OLA, councilData, metadataItem, stubCouncilApi } from "@/test/council-fixtures"
import { jsonResponse } from "@/test/fetch-router"
import { renderCouncil } from "@/test/render-council"
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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

const albumProposal = metadataItem({ id: 7001, createdAt: NOW - 5 * 3600 })
const titleProposal = metadataItem({
  id: 7002,
  videoId: "vXc5jYyfRqY",
  lyricsId: 612,
  song: "One More Hour",
  artist: "Tame Impala",
  before: { song: "One More Hour", artist: "Tame Impala", album: "The Slow Rush" },
  proposed: { song: "One More Hour (Remix)", artist: "Tame Impala", album: "The Slow Rush" },
  createdAt: NOW - 3600,
})

const detail = () => screen.getByRole("region", { name: "Details" })

function voteRoute(log: string[], response = () => jsonResponse({ success: true, data: { ok: true, status: "open" } })) {
  return [
    {
      match: (url: string, init?: RequestInit) => init?.method === "POST" && /\/committee\/metadata\/\d+\/vote$/.test(url),
      respond: (url: string, init?: RequestInit) => {
        log.push(`${url} ${init?.body ?? ""}`.trim())
        return response()
      },
    },
  ]
}

function data(items = [albumProposal, titleProposal]) {
  return councilData({ metadata: { items, needed: 3 } })
}

describe("CouncilMetadataPage", () => {
  it("lists open proposals oldest first with their progress", async () => {
    stubCouncilApi(data(), { admin: false })
    renderCouncil("/council/metadata")
    const list = await screen.findByRole("list", { name: /Open proposals/ })
    const rows = within(list).getAllByRole("listitem")
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Isn't She Lovely"),
      expect.stringContaining("One More Hour"),
    ])
    expect(rows[0].textContent).toContain("1 of 3")
    expect(rows[0].textContent).toContain("Album")
    expect(rows[0].textContent).toContain(OLA.displayName)
  })

  it("shows before and after only for the fields that change", async () => {
    stubCouncilApi(data(), { admin: false })
    renderCouncil("/council/metadata?item=7001")
    await waitFor(() => expect(within(detail()).getByText("Songs in the Key of Life")).toBeTruthy())
    const changes = within(detail()).getByRole("table", { name: "Proposed changes" })
    expect(within(changes).getAllByRole("row")).toHaveLength(1)
    expect(within(changes).getByText("None")).toBeTruthy()
    expect(within(changes).queryByText("Title")).toBeNull()
  })

  it("approves after confirmation with A, then Enter", async () => {
    const log: string[] = []
    stubCouncilApi(data(), { admin: false }, voteRoute(log))
    renderCouncil("/council/metadata?item=7001")
    await waitFor(() => expect(within(detail()).getByRole("button", { name: /^Approve/ })).toBeTruthy())
    act(() => void fireEvent.keyDown(window, { key: "a" }))
    act(() => void fireEvent.keyDown(window, { key: "Enter" }))
    await waitFor(() => expect(log).toEqual(['/committee/metadata/7001/vote {"approve":true}']))
    await screen.findByText("Approved new details for “Isn't She Lovely”")
  })

  it("rejects with a note", async () => {
    const log: string[] = []
    stubCouncilApi(data(), { admin: false }, voteRoute(log))
    renderCouncil("/council/metadata?item=7001")
    await waitFor(() => expect(within(detail()).getByRole("button", { name: /^Reject/ })).toBeTruthy())
    act(() => void fireEvent.keyDown(window, { key: "r" }))
    const note = await within(detail()).findByRole("textbox")
    fireEvent.change(note, { target: { value: "Album is a compilation" } })
    act(() => void fireEvent.keyDown(note, { key: "Enter", metaKey: true, ctrlKey: true }))
    await waitFor(() =>
      expect(log).toEqual(['/committee/metadata/7001/vote {"approve":false,"note":"Album is a compilation"}']),
    )
  })

  describe("edge cases", () => {
    it("tells a member who already approved, and keeps reject open", async () => {
      stubCouncilApi(data([metadataItem({ approvers: [OLA, ME] })]), { admin: false })
      renderCouncil("/council/metadata?item=7001")
      const approved = await within(await screen.findByRole("region", { name: "Details" })).findByRole("button", {
        name: "You approved",
      })
      expect((approved as HTMLButtonElement).disabled).toBe(true)
      expect(within(detail()).getByRole("button", { name: /^Reject/ })).toBeTruthy()
    })

    it("shows an empty state when nothing is open", async () => {
      stubCouncilApi(data([]), { admin: false })
      renderCouncil("/council/metadata")
      expect(await screen.findByText("No open proposals")).toBeTruthy()
    })

    it("never bookmarks a proposal", async () => {
      const router = stubCouncilApi(data(), { admin: false })
      renderCouncil("/council/metadata?item=7001")
      await waitFor(() => expect(within(detail()).getByRole("button", { name: /^Approve/ })).toBeTruthy())
      act(() => void fireEvent.keyDown(window, { key: "b" }))
      expect(within(detail()).queryByRole("button", { name: /Bookmark/ })).toBeNull()
      const list = screen.getByRole("list", { name: /Open proposals/ })
      expect(within(list).queryByRole("button", { name: /Bookmark/ })).toBeNull()
      expect(router.calls.some((call) => call.url.includes("/committee/bookmarks"))).toBe(false)
    })
  })

  describe("error paths", () => {
    it("shows the server hint when the proposal was already decided", async () => {
      const log: string[] = []
      stubCouncilApi(
        data(),
        { admin: false },
        voteRoute(log, () =>
          jsonResponse(
            {
              success: false,
              error: "Already decided",
              code: "ALREADY_DECIDED",
              hint: "This proposal already passed or was rejected. Refresh the dashboard.",
            },
            409,
          ),
        ),
      )
      renderCouncil("/council/metadata?item=7001")
      await waitFor(() => expect(within(detail()).getByRole("button", { name: /^Approve/ })).toBeTruthy())
      act(() => void fireEvent.keyDown(window, { key: "a" }))
      act(() => void fireEvent.keyDown(window, { key: "Enter" }))
      expect(await screen.findByText("This proposal already passed or was rejected. Refresh the dashboard.")).toBeTruthy()
    })
  })
})
