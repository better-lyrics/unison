import { __resetToastStore } from "@/lib/toast"
import { ME, NOW, OLA, councilData, flagItem, queueItem, stubCouncilApi, variantFull } from "@/test/council-fixtures"
import type { FetchRoute } from "@/test/fetch-router"
import { jsonResponse } from "@/test/fetch-router"
import { renderCouncil } from "@/test/render-council"
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@braccato/core/element", () => ({}))

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

const spamFlag = flagItem({ id: 8001, openedAt: NOW - 5 * 3600 })
const lyricFlag = flagItem({
  id: 8002,
  lyricsId: 612,
  videoId: "vXc5jYyfRqY",
  song: "One More Hour",
  artist: "Tame Impala",
  openedAt: NOW - 3600,
  reports: [{ id: 31, reason: "offensive", details: null, reporter: OLA, createdAt: NOW - 3600 }],
  removers: [OLA],
})

const detail = () => screen.getByRole("region", { name: "Details" })
const selected = () => document.querySelector("[aria-current='true'][data-key]")?.getAttribute("data-key")
const press = (key: string) => act(() => void fireEvent.keyDown(window, { key }))
const ALREADY_DECIDED_HINT = "Another council member already decided this flag. Refresh the dashboard."

function failingVote(log: string[], status: number, body: object) {
  return voteRoute(log, () => jsonResponse({ success: false, ...body }, status))
}
const OPEN_TALLY = { status: "open", removals: 1, keeps: 0, needed: 3 }

function voteRoute(
  log: string[],
  response: () => Response | Promise<Response> = () => jsonResponse({ success: true, data: OPEN_TALLY }),
) {
  return [
    {
      match: (url: string, init?: RequestInit) => init?.method === "POST" && /\/committee\/flags\/\d+\/vote$/.test(url),
      respond: (url: string, init?: RequestInit) => {
        log.push(`${url} ${init?.body ?? ""}`.trim())
        return response()
      },
    },
  ]
}

function data(items = [spamFlag, lyricFlag]) {
  return councilData({ flags: { items, needed: 3 }, variants: [variantFull(queueItem())] })
}

async function openDetail(id = 8001) {
  renderCouncil(`/council/flags?item=${id}`)
  await waitFor(() => expect(within(detail()).getByRole("button", { name: /^Remove/ })).toBeTruthy())
}

describe("CouncilFlagsPage", () => {
  it("lists open flags oldest first with their progress", async () => {
    stubCouncilApi(data(), { admin: false })
    renderCouncil("/council/flags")
    const list = await screen.findByRole("list", { name: /Open flags/ })
    const rows = within(list).getAllByRole("listitem")
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Story of a Warrior"),
      expect.stringContaining("One More Hour"),
    ])
    expect(rows[0].textContent).toContain("0 of 3")
    expect(rows[0].textContent).toContain("2 reports")
    expect(rows[1].textContent).toContain("1 of 3")
  })

  it("shows the song, submitter, reports by reason and the tally", async () => {
    stubCouncilApi(data(), { admin: false })
    await openDetail()
    const text = () => detail().textContent ?? ""
    expect(within(detail()).getByRole("heading", { name: "Story of a Warrior" })).toBeTruthy()
    expect(text()).toContain("John Michael Howell")
    expect(text()).toContain("SigmaViolinRemix")
    expect(text()).toContain("Remove 0 of 3")
    expect(within(detail()).getByText("Spam")).toBeTruthy()
    expect(within(detail()).getByText("Wrong song")).toBeTruthy()
    expect(within(detail()).queryByText("Offensive")).toBeNull()
    expect(text()).toContain("Ad link in every line")
    expect(text()).toContain(OLA.displayName)
    expect(
      within(detail())
        .getByRole("link", { name: /Open in YouTube Music/ })
        .getAttribute("href"),
    ).toBe("https://music.youtube.com/watch?v=SMQpJ9x7zEk")
  })

  it("previews the flagged lyric", async () => {
    stubCouncilApi(data(), { admin: false })
    await openDetail()
    expect(within(detail()).getByText("Lyric preview")).toBeTruthy()
    await waitFor(() =>
      expect((within(detail()).getByRole("button", { name: /^Play\s?P$/ }) as HTMLButtonElement).disabled).toBe(false),
    )
  })

  it("lists the members who voted to remove", async () => {
    stubCouncilApi(data(), { admin: false })
    await openDetail(8002)
    expect(detail().textContent).toContain("Remove 1 of 3")
    expect(within(detail()).getByText("Voted to remove")).toBeTruthy()
  })

  it("removes after confirmation with A, then Enter", async () => {
    const log: string[] = []
    stubCouncilApi(data(), { admin: false }, voteRoute(log))
    await openDetail()
    act(() => void fireEvent.keyDown(window, { key: "a" }))
    expect(await within(detail()).findByText("Remove this lyric?")).toBeTruthy()
    expect(detail().textContent).toContain(
      "Removing deletes this lyric and penalises its submitter once the quorum is reached.",
    )
    act(() => void fireEvent.keyDown(window, { key: "Enter" }))
    await waitFor(() => expect(log).toEqual(['/committee/flags/8001/vote {"remove":true}']))
    await screen.findByText("Vote counted on “Story of a Warrior”")
  })

  it("says the lyric was removed once the quorum is reached", async () => {
    stubCouncilApi(
      data(),
      { admin: false },
      voteRoute([], () =>
        jsonResponse({ success: true, data: { status: "removed", removals: 3, keeps: 0, needed: 3 } }),
      ),
    )
    await openDetail()
    press("a")
    press("Enter")
    expect(await screen.findByText("Removed “Story of a Warrior”")).toBeTruthy()
  })

  it("keeps with a note", async () => {
    const log: string[] = []
    stubCouncilApi(
      data(),
      { admin: false },
      voteRoute(log, () => jsonResponse({ success: true, data: { status: "kept", removals: 0, keeps: 1, needed: 3 } })),
    )
    await openDetail()
    fireEvent.click(within(detail()).getByRole("button", { name: /^Keep/ }))
    const note = await within(detail()).findByRole("textbox", { name: /^Why keep it\? \(optional\)/ })
    expect(note.getAttribute("placeholder")).toBe("For example: these are real lyrics, the reports are wrong")
    expect(detail().textContent).toContain("Keeping makes the lyric visible again and closes the flag.")
    fireEvent.change(note, { target: { value: "Lyrics match the song" } })
    act(() => void fireEvent.keyDown(note, { key: "Enter", metaKey: true, ctrlKey: true }))
    await waitFor(() =>
      expect(log).toEqual(['/committee/flags/8001/vote {"remove":false,"note":"Lyrics match the song"}']),
    )
    await screen.findByText("Kept “Story of a Warrior”")
  })

  it("keeps without a note", async () => {
    const log: string[] = []
    stubCouncilApi(data(), { admin: false }, voteRoute(log))
    await openDetail()
    act(() => void fireEvent.keyDown(window, { key: "r" }))
    fireEvent.click(await within(detail()).findByRole("button", { name: /^Keep/ }))
    await waitFor(() => expect(log).toEqual(['/committee/flags/8001/vote {"remove":false}']))
  })

  describe("edge cases", () => {
    it("blocks both votes for the submitter", async () => {
      stubCouncilApi(data([flagItem({ submitter: ME, conflict: "submitter" })]), { admin: false })
      renderCouncil("/council/flags?item=8001")
      const blocked = await within(await screen.findByRole("region", { name: "Details" })).findByRole("button", {
        name: "You submitted this lyric",
      })
      expect((blocked as HTMLButtonElement).disabled).toBe(true)
      expect((within(detail()).getByRole("button", { name: /^Keep/ }) as HTMLButtonElement).disabled).toBe(true)
    })

    it("blocks both votes for a member whose report is not listed", async () => {
      stubCouncilApi(data([flagItem({ conflict: "reporter" })]), { admin: false })
      renderCouncil("/council/flags?item=8001")
      const blocked = await within(await screen.findByRole("region", { name: "Details" })).findByRole("button", {
        name: "You reported this lyric",
      })
      expect((blocked as HTMLButtonElement).disabled).toBe(true)
      const keep = within(detail()).getByRole("button", { name: /^Keep/ })
      expect((keep as HTMLButtonElement).disabled).toBe(true)
      fireEvent.mouseEnter(keep.closest("[data-unavailable-hint]") as Element)
      expect((await screen.findByRole("tooltip")).textContent).toBe("You reported this lyric")
    })

    it("ignores R and A under a conflict", async () => {
      const log: string[] = []
      stubCouncilApi(data([flagItem({ conflict: "reporter" })]), { admin: false }, voteRoute(log))
      renderCouncil("/council/flags?item=8001")
      await within(await screen.findByRole("region", { name: "Details" })).findByRole("button", {
        name: "You reported this lyric",
      })
      press("r")
      expect(within(detail()).queryByRole("textbox")).toBeNull()
      press("a")
      expect(detail().textContent).not.toContain("Remove this lyric?")
      expect(log).toEqual([])
    })

    it("moves to the next flag after a vote", async () => {
      stubCouncilApi(data(), { admin: false }, voteRoute([]))
      await openDetail()
      await waitFor(() => expect(selected()).toBe("8001"))
      press("a")
      press("Enter")
      await waitFor(() => expect(selected()).toBe("8002"))
    })

    it("sends one vote while the first is still in flight", async () => {
      const log: string[] = []
      stubCouncilApi(
        data(),
        { admin: false },
        voteRoute(log, () => new Promise<Response>(() => {})),
      )
      await openDetail()
      press("a")
      press("Enter")
      await waitFor(() => expect(log).toHaveLength(1))
      await waitFor(() => expect(selected()).toBe("8002"))
      press("a")
      press("Enter")
      press("r")
      expect(within(detail()).queryByRole("textbox")).toBeNull()
      expect(log).toEqual(['/committee/flags/8001/vote {"remove":true}'])
    })

    it("shows nothing selected when the selected flag closes elsewhere", async () => {
      const server = data([spamFlag])
      stubCouncilApi(server, { admin: false })
      const { client } = renderCouncil("/council/flags?item=8001")
      await waitFor(() => expect(within(detail()).getByRole("button", { name: /^Remove/ })).toBeTruthy())
      server.flags.items = []
      await act(() => client.invalidateQueries())
      expect(await screen.findByText("Nothing selected")).toBeTruthy()
    })

    it("tells a member who already voted to remove", async () => {
      stubCouncilApi(data([flagItem({ removers: [ME] })]), { admin: false })
      renderCouncil("/council/flags?item=8001")
      const voted = await within(await screen.findByRole("region", { name: "Details" })).findByRole("button", {
        name: "You voted to remove",
      })
      expect((voted as HTMLButtonElement).disabled).toBe(true)
    })

    it("shows an empty state when nothing is open", async () => {
      stubCouncilApi(data([]), { admin: false })
      renderCouncil("/council/flags")
      expect(await screen.findByText("No open flags")).toBeTruthy()
    })

    it("never bookmarks a flag", async () => {
      const router = stubCouncilApi(data(), { admin: false })
      await openDetail()
      act(() => void fireEvent.keyDown(window, { key: "b" }))
      expect(within(detail()).queryByRole("button", { name: /Bookmark/ })).toBeNull()
      const list = screen.getByRole("list", { name: /Open flags/ })
      expect(within(list).queryByRole("button", { name: /Bookmark/ })).toBeNull()
      expect(router.calls.some((call) => call.url.includes("/committee/bookmarks"))).toBe(false)
    })
  })

  describe("error paths", () => {
    const removeWith = async (routes: FetchRoute[]) => {
      stubCouncilApi(data(), { admin: false }, routes)
      await openDetail()
      press("a")
      press("Enter")
    }

    it("shows the server hint when the flag was already decided", async () => {
      await removeWith(
        failingVote([], 409, { error: "Already decided", code: "ALREADY_DECIDED", hint: ALREADY_DECIDED_HINT }),
      )
      expect(await screen.findByText(ALREADY_DECIDED_HINT)).toBeTruthy()
    })

    it("explains a conflict the page did not know about", async () => {
      await removeWith(
        failingVote([], 409, {
          error: "You cannot vote on this flag",
          code: "FLAG_CONFLICT",
          hint: "You submitted or reported this lyric, so another council member has to decide it.",
        }),
      )
      expect(await screen.findByText("You cannot vote on this flag")).toBeTruthy()
      expect(
        screen.getByText("You submitted or reported this lyric, so another council member has to decide it."),
      ).toBeTruthy()
    })

    it("asks the member to slow down when rate limited", async () => {
      await removeWith(failingVote([], 429, { error: "Rate limited. Try again later.", code: "RATE_LIMITED" }))
      expect(await screen.findByText("Too many council actions. Try again in a minute.")).toBeTruthy()
    })
  })
})
