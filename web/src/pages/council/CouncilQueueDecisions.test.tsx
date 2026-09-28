import type { QueueItem } from "@/lib/council-types"
import { __resetToastStore } from "@/lib/toast"
import {
  type CouncilData,
  ME,
  NOW,
  OLA,
  bookmarkBy,
  councilData,
  councilEvent,
  overview,
  queueItem,
  stubCouncilApi,
  variantFull,
} from "@/test/council-fixtures"
import { jsonResponse } from "@/test/fetch-router"
import { renderCouncil } from "@/test/render-council"
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@braccato/core/element", () => ({}))

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

const story = queueItem({ id: 722, song: "Story of a Warrior", upvotes: 37, downvotes: 1, requestsFilled: 1 })
const rabbit = queueItem({ id: 1320, videoId: "Iqw03oGysxE", song: "Run Rabbit", score: 0.95 })
const catchCatch = queueItem({ id: 406, videoId: "sjtyqmA-pH4", song: "Catch Catch", score: 0.9 })

function data() {
  return councilData({
    queue: [story, rabbit, catchCatch],
    variants: [
      variantFull(story),
      variantFull(story, { id: 900, format: "lrc", effectiveScore: 0.71, lyrics: "[00:01.00]Amazing grace" }),
    ],
  })
}

const detail = () => screen.getByRole("region", { name: "Details" })
const selected = () => document.querySelector("[aria-current='true'][data-key]")?.getAttribute("data-key")
const press = (key: string, init: KeyboardEventInit = {}) => act(() => void fireEvent.keyDown(window, { key, ...init }))

function decisionRoutes(log: string[], server: CouncilData, opts: { fail?: boolean } = {}) {
  const removed = new Map<number, QueueItem>()
  return [
    {
      match: (url: string, init?: RequestInit) =>
        /^\/lyrics\/\d+\/(boost|reject)$/.test(url) && init?.method !== undefined,
      respond: (url: string, init?: RequestInit) => {
        log.push(`${init?.method} ${url} ${init?.body ?? ""}`.trim())
        if (opts.fail)
          return jsonResponse({ success: false, error: "Monthly seal quota reached", hint: "Wait for Oct 1." }, 409)
        const id = Number(url.split("/")[2])
        if (init?.method === "POST") {
          const item = server.queue.find((i) => i.id === id)
          if (item) removed.set(id, item)
          server.queue = server.queue.filter((i) => i.id !== id)
        } else {
          const item = removed.get(id)
          if (item) server.queue = [...server.queue, item]
        }
        return jsonResponse({ success: true, data: null })
      },
    },
  ]
}

describe("SealDetail", () => {
  it("shows the facts, checks, variants and council history of the selected lyric", async () => {
    const d = data()
    d.events = {
      events: [
        councilEvent({ kind: "reject", actor: { ...OLA }, note: "Chorus timing lands early.", at: NOW - 11 * DAY }),
      ],
      nextCursor: null,
    }
    stubCouncilApi(d)
    renderCouncil("/council/queue?item=722")
    await waitFor(() => expect(within(detail()).getByRole("heading", { name: "Story of a Warrior" })).toBeTruthy())
    const text = () => detail().textContent ?? ""
    expect(text()).toContain("0.97")
    expect(text()).toContain("37 / 1")
    expect(within(detail()).getByRole("img", { name: "37 up, 1 down" })).toBeTruthy()
    expect(text()).toContain("No automatic flags")
    expect(text()).toContain("High confidence")
    await waitFor(() => expect(text()).toContain("Other variants for this song"))
    await waitFor(() => expect(text()).toContain("olafix52 rejected it11d"))
    expect(text()).toContain("Chorus timing lands early.")
    expect(
      within(detail())
        .getByRole("link", { name: /Open in YouTube Music/ })
        .getAttribute("href"),
    ).toBe("https://music.youtube.com/watch?v=SMQpJ9x7zEk")
  })

  it("shows the submitter first, above the numbers and the lyric", async () => {
    stubCouncilApi(data())
    renderCouncil("/council/queue?item=722")
    const submitter = await within(await screen.findByRole("region", { name: "Details" })).findByText("Submitter")
    const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(follows(submitter, within(detail()).getByText("Effective score"))).toBe(true)
    expect(follows(submitter, within(detail()).getByText("Lyric preview"))).toBe(true)
  })

  it("plays the real song in the preview, from the first line", async () => {
    const players: { videoId: string; seeks: number[]; plays: number; pauses: number; state: number }[] = []
    class FakePlayer {
      rec: (typeof players)[number]
      constructor(_el: HTMLElement, opts: { videoId: string; events?: { onReady?: () => void } }) {
        this.rec = { videoId: opts.videoId, seeks: [], plays: 0, pauses: 0, state: 2 }
        players.push(this.rec)
        queueMicrotask(() => opts.events?.onReady?.())
      }
      seekTo(seconds: number) {
        this.rec.seeks.push(seconds)
      }
      playVideo() {
        this.rec.plays++
        this.rec.state = 1
      }
      pauseVideo() {
        this.rec.pauses++
        this.rec.state = 2
      }
      getPlayerState() {
        return this.rec.state
      }
      getCurrentTime() {
        return 0
      }
      destroy() {}
    }
    vi.stubGlobal("YT", { Player: FakePlayer })
    stubCouncilApi(data())
    renderCouncil("/council/queue?item=722")
    const play = await within(await screen.findByRole("region", { name: "Details" })).findByRole("button", {
      name: /^Play\s?P$/,
    })
    await waitFor(() => expect((play as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(play)
    await waitFor(() => expect(players[0]?.plays).toBe(1))
    expect(players[0]).toMatchObject({ videoId: "SMQpJ9x7zEk", seeks: [3.5] })
    press("p")
    expect(players[0].pauses).toBe(1)
  })

  it("plays from the first line when the cover is clicked, like the song page", async () => {
    const players: { videoId: string; seeks: number[]; plays: number; pauses: number; state: number }[] = []
    class FakePlayer {
      rec: (typeof players)[number]
      constructor(_el: HTMLElement, opts: { videoId: string; events?: { onReady?: () => void } }) {
        this.rec = { videoId: opts.videoId, seeks: [], plays: 0, pauses: 0, state: 2 }
        players.push(this.rec)
        queueMicrotask(() => opts.events?.onReady?.())
      }
      seekTo(seconds: number) {
        this.rec.seeks.push(seconds)
      }
      playVideo() {
        this.rec.plays++
        this.rec.state = 1
      }
      pauseVideo() {
        this.rec.pauses++
        this.rec.state = 2
      }
      getPlayerState() {
        return this.rec.state
      }
      getCurrentTime() {
        return 0
      }
      destroy() {}
    }
    vi.stubGlobal("YT", { Player: FakePlayer })
    stubCouncilApi(data())
    renderCouncil("/council/queue?item=722")
    const play = await within(await screen.findByRole("region", { name: "Details" })).findByRole("button", {
      name: "Play Story of a Warrior",
    })
    await waitFor(() => expect((play as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(play)
    await waitFor(() => expect(players[0]?.plays).toBe(1))
    expect(players[0]).toMatchObject({ videoId: "SMQpJ9x7zEk", seeks: [3.5] })
  })

  it("lists automatic flags with their labels", async () => {
    const d = data()
    d.queue = [{ ...story, flags: [{ code: "line-synced", label: "Line-synced, not word-by-word" }] }]
    stubCouncilApi(d)
    renderCouncil("/council/queue?item=722")
    await waitFor(() => expect(detail().textContent).toContain("Line-synced, not word-by-word"))
  })

  it("explains my bookmark and another member's bookmark", async () => {
    const d = data()
    d.queue = [
      { ...story, bookmark: { ...bookmarkBy(ME), createdAt: NOW - 44 * HOUR, expiresAt: NOW + 28 * HOUR } },
      { ...rabbit, bookmark: { ...bookmarkBy(OLA, 2), createdAt: NOW - 22 * HOUR, expiresAt: NOW + 50 * HOUR } },
    ]
    stubCouncilApi(d)
    renderCouncil("/council/queue?item=722")
    await waitFor(() => expect(detail().textContent).toContain("You bookmarked this 2d ago."))
    expect(detail().textContent).toContain("1d 4h left.")
    expect(within(detail()).getByRole("button", { name: /Release/ })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /Bookmarked by others/ }))
    fireEvent.click(screen.getByRole("link", { name: /Run Rabbit/ }))
    await waitFor(() => expect(detail().textContent).toContain("olafix52 bookmarked this 22h ago."))
    expect(detail().textContent).toContain("You can still decide. olafix52 will see your decision.")
    expect(
      (within(detail()).getByRole("button", { name: "Bookmarked by olafix52" }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})

describe("sealing", () => {
  it("asks to confirm, seals, removes the item, opens the next one and offers undo", async () => {
    const log: string[] = []
    const server = data()
    stubCouncilApi(server, { admin: false }, decisionRoutes(log, server))
    renderCouncil("/council/queue?item=722")
    await waitFor(() => expect(selected()).toBe("722"))
    fireEvent.click(within(detail()).getByRole("button", { name: /^Seal/ }))
    expect(detail().textContent).toContain("Seal “Story of a Warrior”?")
    expect(detail().textContent).toContain("This uses 1 of your 2 remaining seals this month.")
    fireEvent.click(within(detail()).getByRole("button", { name: /Seal lyric/ }))
    await waitFor(() => expect(log).toEqual(["POST /lyrics/722/boost {}"]))
    expect(selected()).toBe("1320")
    expect(screen.queryByRole("link", { name: /Story of a Warrior/ })).toBeNull()
    const toast = await screen.findByText("Sealed “Story of a Warrior”")
    fireEvent.click(within(toast.closest("output") as HTMLElement).getByRole("button", { name: "Undo" }))
    await waitFor(() => expect(log).toContain("DELETE /lyrics/722/boost"))
    await screen.findByText("Seal lifted from “Story of a Warrior”")
  })

  it("keeps only the latest decision toast", async () => {
    const log: string[] = []
    const server = data()
    stubCouncilApi(server, { admin: false }, decisionRoutes(log, server))
    renderCouncil("/council/queue?item=722")
    await waitFor(() => expect(selected()).toBe("722"))
    press("s")
    press("Enter")
    await screen.findByText("Sealed “Story of a Warrior”")
    await waitFor(() => expect(selected()).toBe("1320"))
    press("r")
    fireEvent.click(within(detail()).getByRole("button", { name: /Reject lyric/ }))
    await screen.findByText("Rejected “Run Rabbit”")
    expect(screen.queryByText("Sealed “Story of a Warrior”")).toBeNull()
    expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(1)
  })

  it("seals from the keyboard with S, then Enter to confirm", async () => {
    const log: string[] = []
    const server = data()
    stubCouncilApi(server, { admin: false }, decisionRoutes(log, server))
    renderCouncil("/council/queue?item=722")
    await waitFor(() => expect(within(detail()).getByRole("button", { name: /^Seal/ })).toBeTruthy())
    press("s")
    expect(detail().textContent).toContain("Seal “Story of a Warrior”?")
    await waitFor(() =>
      expect(document.activeElement).toBe(within(detail()).getByRole("button", { name: /^Seal lyric/ })),
    )
    press("Enter")
    await waitFor(() => expect(log).toEqual(["POST /lyrics/722/boost {}"]))
  })

  it("regression: Enter on a focused button runs that button, not the seal", async () => {
    const log: string[] = []
    const server = data()
    stubCouncilApi(server, { admin: false }, decisionRoutes(log, server))
    renderCouncil("/council/queue?item=722")
    await waitFor(() => expect(within(detail()).getByRole("button", { name: /^Seal/ })).toBeTruthy())
    press("s")
    const cancel = within(detail()).getByRole("button", { name: "Cancel" })
    cancel.focus()
    act(() => void fireEvent.keyDown(cancel, { key: "Enter" }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(log).toEqual([])
  })

  it("regression: a double tap on S asks but never seals", async () => {
    const log: string[] = []
    const server = data()
    stubCouncilApi(server, { admin: false }, decisionRoutes(log, server))
    renderCouncil("/council/queue?item=722")
    await waitFor(() => expect(within(detail()).getByRole("button", { name: /^Seal/ })).toBeTruthy())
    press("s")
    press("s")
    expect(detail().textContent).toContain("Seal “Story of a Warrior”?")
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(log).toEqual([])
  })

  it("puts the item back and shows the reason when sealing fails", async () => {
    const log: string[] = []
    const server = data()
    stubCouncilApi(server, { admin: false }, decisionRoutes(log, server, { fail: true }))
    renderCouncil("/council/queue?item=722")
    await waitFor(() => expect(selected()).toBe("722"))
    press("s")
    press("Enter")
    await screen.findByText("Monthly seal quota reached")
    expect(screen.getByText("Wait for Oct 1.")).toBeTruthy()
    await waitFor(() => expect(screen.getByRole("link", { name: /Story of a Warrior/ })).toBeTruthy())
  })

  it("cannot seal with no seals left this month", async () => {
    const d = data()
    d.overview = overview()
    d.overview.me.quota = { ...d.overview.me.quota, used: 3, remaining: 0 }
    stubCouncilApi(d)
    renderCouncil("/council/queue?item=722")
    const button = await waitFor(() => within(detail()).getByRole("button", { name: /No seals left until Oct 1/ }))
    expect((button as HTMLButtonElement).disabled).toBe(true)
    press("s")
    expect(detail().textContent).not.toContain("Seal “Story of a Warrior”?")
  })
})

describe("rejecting", () => {
  it("rejects with a reason using Mod+Enter and keeps the selection empty when auto advance is off", async () => {
    localStorage.setItem("council.autoAdvance", "off")
    const log: string[] = []
    const server = data()
    stubCouncilApi(server, { admin: false }, decisionRoutes(log, server))
    renderCouncil("/council/queue?item=722")
    await waitFor(() => expect(selected()).toBe("722"))
    press("r")
    const reason = within(detail()).getByRole("textbox", { name: /Reason for the council/ })
    fireEvent.change(reason, { target: { value: "  Background vocals merged into the lead.  " } })
    expect(detail().textContent).toContain("43/300")
    act(() => void fireEvent.keyDown(reason, { key: "Enter", metaKey: true }))
    await waitFor(() =>
      expect(log).toEqual([`POST /lyrics/722/reject {"note":"Background vocals merged into the lead."}`]),
    )
    expect(selected()).toBeUndefined()
    await screen.findByText("Nothing selected")
    const toast = await screen.findByText("Rejected “Story of a Warrior”")
    fireEvent.click(within(toast.closest("output") as HTMLElement).getByRole("button", { name: "Undo" }))
    await waitFor(() => expect(log).toContain("DELETE /lyrics/722/reject"))
  })

  it("sends no note for an empty reason and cancels with Escape", async () => {
    const log: string[] = []
    const server = data()
    stubCouncilApi(server, { admin: false }, decisionRoutes(log, server))
    renderCouncil("/council/queue?item=722")
    await waitFor(() => expect(selected()).toBe("722"))
    fireEvent.click(within(detail()).getByRole("button", { name: /^Reject/ }))
    const reason = within(detail()).getByRole("textbox", { name: /Reason for the council/ })
    fireEvent.keyDown(reason, { key: "Escape" })
    expect(within(detail()).queryByRole("textbox")).toBeNull()
    fireEvent.click(within(detail()).getByRole("button", { name: /^Reject/ }))
    fireEvent.click(within(detail()).getByRole("button", { name: /Reject lyric/ }))
    await waitFor(() => expect(log).toEqual([`POST /lyrics/722/reject {"note":null}`]))
  })
})
