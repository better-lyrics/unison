import { ME, NOW, OLA, councilData, editItem, queueItem, rosterMember, stubCouncilApi } from "@/test/council-fixtures"
import { renderCouncil } from "@/test/render-council"
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { useLocation } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

function Where() {
  const location = useLocation()
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>
}

const probes = ["", "queue", "edits", "bookmarks", "applicants", "activity", "members"].map((p) =>
  p === "" ? { index: true, element: <Where /> } : { path: p, element: <Where /> },
)

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

function data() {
  return councilData({
    queue: [queueItem({ id: 722, song: "Story of a Warrior" }), queueItem({ id: 1320, song: "Run Rabbit" })],
    edits: {
      items: [editItem({ revisionId: 9001, song: "Isn't She Lovely" })],
      thresholds: { textDrift: 0.15, timingDrift: 0.3, jevFlag: 0.7 },
    },
    members: [rosterMember(ME), rosterMember(OLA)],
  })
}

const press = (key: string, init: KeyboardEventInit = {}) => act(() => void fireEvent.keyDown(window, { key, ...init }))
const where = () => screen.getByTestId("where").textContent
const menu = () => screen.getByRole("dialog", { name: "Command menu" })
const options = () =>
  within(menu())
    .queryAllByRole("option")
    .map((o) => o.textContent)

describe("CommandMenu", () => {
  it("opens with Mod+K, lists sections, and goes to one with Enter", async () => {
    stubCouncilApi(data())
    renderCouncil("/council", probes)
    await screen.findByRole("navigation", { name: "Council sections" })
    press("k", { metaKey: true })
    const input = await screen.findByRole("combobox", { name: "Type a command or a song title" })
    await waitFor(() => expect(document.activeElement).toBe(input))
    expect(options()[0]).toContain("Overview")
    expect(options()).toHaveLength(7)
    const sections = within(menu()).getByRole("group", { name: "Go to" })
    expect(within(sections).getAllByRole("option")).toHaveLength(7)
    fireEvent.keyDown(input, { key: "ArrowDown" })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(where()).toBe("/council/queue"))
    expect(screen.queryByRole("dialog", { name: "Command menu" })).toBeNull()
  })

  it("finds queue items, edits and members by name", async () => {
    stubCouncilApi(data())
    renderCouncil("/council", probes)
    await screen.findByRole("navigation", { name: "Council sections" })
    press("k", { ctrlKey: true })
    const input = await screen.findByRole("combobox")
    fireEvent.change(input, { target: { value: "lovely" } })
    await waitFor(() => expect(options()).toEqual(["Isn't She Lovely · Stevie WonderEdit"]))
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(where()).toBe("/council/edits?item=9001"))
    press("k", { metaKey: true })
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "olafix" } })
    await waitFor(() => expect(options()).toEqual(["olafix52's activity"]))
    expect(
      within(menu())
        .getAllByRole("group")
        .map((g) => g.getAttribute("aria-label")),
    ).toEqual(["Members"])
    fireEvent.click(within(menu()).getByRole("option"))
    await waitFor(() => expect(where()).toBe(`/council/activity?actor=${OLA.keyId}`))
  })

  it("says so when nothing matches and closes with Escape", async () => {
    stubCouncilApi(data())
    renderCouncil("/council", probes)
    await screen.findByRole("navigation", { name: "Council sections" })
    press("k", { metaKey: true })
    const input = await screen.findByRole("combobox")
    fireEvent.change(input, { target: { value: "zzzz" } })
    expect(within(menu()).getByText("No matches.")).toBeTruthy()
    fireEvent.keyDown(input, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("opens from the rail and returns focus to the button when closed", async () => {
    stubCouncilApi(data())
    renderCouncil("/council", probes)
    const button = await screen.findByRole("button", { name: /Command menu/ })
    button.focus()
    fireEvent.click(button)
    const input = await screen.findByRole("combobox")
    fireEvent.keyDown(input, { key: "Escape" })
    await waitFor(() => expect(document.activeElement).toBe(button))
  })
})

describe("ShortcutsSheet", () => {
  it("opens with ? and lists the shortcuts", async () => {
    stubCouncilApi(data())
    renderCouncil("/council", probes)
    await screen.findByRole("navigation", { name: "Council sections" })
    press("?", { shiftKey: true })
    const sheet = await screen.findByRole("dialog", { name: "Keyboard shortcuts" })
    expect(within(sheet).getByText("Go to seal queue")).toBeTruthy()
    expect(within(sheet).getByText("Reject with a reason")).toBeTruthy()
    const row = (label: string) => within(sheet).getByText(label).parentElement?.textContent
    expect(row("Go to seal queue")).toBe("Go to seal queueGthenQ")
    expect(row("Next or previous item")).toBe("Next or previous itemJorK")
    expect(row("Seal a lyric")).toBe("Seal a lyricSthen↵")
    expect(row("Approve an edit")).toBe("Approve an editAthen↵")
    expect(row("Send the rejection")).toContain("↵")
    expect(row("Cancel a decision or close a dialog")).toContain("Esc")
    press("g")
    press("q")
    expect(where()).toBe("/council")
  })

  it("regression: keeps page shortcuts off while a dialog is open, even before focus moves into it", async () => {
    stubCouncilApi(data())
    renderCouncil("/council", probes)
    await screen.findByRole("navigation", { name: "Council sections" })
    press("?", { shiftKey: true })
    await screen.findByRole("dialog", { name: "Keyboard shortcuts" })
    act(() => (document.activeElement as HTMLElement | null)?.blur())
    press("g")
    press("q")
    expect(where()).toBe("/council")
  })
})
