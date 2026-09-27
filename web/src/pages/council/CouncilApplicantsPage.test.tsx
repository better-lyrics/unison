import { withOpinion } from "@/hooks/useCouncilMutations"
import type { OpinionStance } from "@/lib/council-types"
import { __resetToastStore } from "@/lib/toast"
import { type CouncilData, ME, NOW, OLA, applicant, councilData, stubCouncilApi } from "@/test/council-fixtures"
import { jsonResponse } from "@/test/fetch-router"
import { renderCouncil } from "@/test/render-council"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
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

const golden = applicant({
  applicantId: 71,
  displayName: "GoldenKickWhisper",
  score: 94,
  cutoff: 85,
  opinions: {
    support: [{ ...OLA }],
    object: [],
    notes: [{ by: { ...OLA }, stance: "support", note: "Strong timing section." }],
    mine: null,
  },
})
const noobot = applicant({
  applicantId: 70,
  keyId: "c2".repeat(32),
  displayName: "NooBot",
  score: 79,
  state: "failed",
  retakeAt: Date.UTC(2027, 2, 15) / 1000,
})

function opinionRoute(log: string[], server: CouncilData, status = 200) {
  return {
    match: (url: string, init?: RequestInit) => init?.method === "PUT" && /\/applicants\/\d+\/opinion$/.test(url),
    respond: (url: string, init?: RequestInit) => {
      log.push(`${url} ${init?.body}`)
      if (status !== 200) return jsonResponse({ success: false, error: "Could not save that opinion" }, status)
      const { stance } = JSON.parse(String(init?.body)) as { stance: OpinionStance | null }
      server.applicants = server.applicants.map((a) => withOpinion(a, ME, stance))
      return jsonResponse({ success: true })
    },
  }
}

const card = (name: string) => screen.getByRole("article", { name })

describe("CouncilApplicantsPage", () => {
  it("shows each pending applicant with the score, the cutoff and what others think", async () => {
    stubCouncilApi(councilData({ applicants: [golden, noobot] }))
    renderCouncil("/council/applicants")
    await screen.findByRole("article", { name: "GoldenKickWhisper" })
    const text = card("GoldenKickWhisper").textContent
    expect(text).toContain("94%")
    expect(text).toContain("cutoff 85%")
    expect(text).toContain("Is it exceptional?")
    expect(text).toContain("29/30")
    expect(text).toContain("olafix52: Strong timing section.")
    expect(within(card("GoldenKickWhisper")).getByRole("button", { name: /Support/ }).textContent).toContain("1")
    expect(screen.queryByRole("article", { name: "NooBot" })).toBeNull()
  })

  it("shows near misses on request, with the retake date", async () => {
    const router = stubCouncilApi(councilData({ applicants: [golden, noobot] }))
    renderCouncil("/council/applicants")
    await screen.findByRole("article", { name: "GoldenKickWhisper" })
    fireEvent.click(screen.getByRole("switch", { name: "Show near misses" }))
    await screen.findByRole("article", { name: "NooBot" })
    expect(card("NooBot").textContent).toContain("can retake in Mar 2027")
    expect(card("NooBot").textContent).toContain("Below the cutoff. Shown for context only.")
    expect(within(card("NooBot")).queryByRole("button", { name: /Support/ })).toBeNull()
    expect(router.calls.some((c) => c.url === "/committee/applicants?includeBelowCutoff=1")).toBe(true)
  })

  it("records my support and takes it back on a second click", async () => {
    const log: string[] = []
    const server = councilData({ applicants: [golden] })
    stubCouncilApi(server, { admin: false }, [opinionRoute(log, server)])
    renderCouncil("/council/applicants")
    const support = () => within(card("GoldenKickWhisper")).getByRole("button", { name: /Support/ })
    await waitFor(support)
    fireEvent.click(support())
    await waitFor(() => expect(support().getAttribute("aria-pressed")).toBe("true"))
    expect(support().textContent).toContain("2")
    await waitFor(() => expect(log).toEqual([`/committee/applicants/71/opinion {"stance":"support"}`]))
    fireEvent.click(support())
    await waitFor(() => expect(support().getAttribute("aria-pressed")).toBe("false"))
    await waitFor(() => expect(log[1]).toBe(`/committee/applicants/71/opinion {"stance":null}`))
  })

  it("moves my opinion from support to object", async () => {
    const log: string[] = []
    const mineSupport = {
      ...golden,
      opinions: { ...golden.opinions, support: [{ ...OLA }, { ...ME }], mine: "support" as const },
    }
    const server = councilData({ applicants: [mineSupport] })
    stubCouncilApi(server, { admin: false }, [opinionRoute(log, server)])
    renderCouncil("/council/applicants")
    const button = (name: RegExp) => within(card("GoldenKickWhisper")).getByRole("button", { name })
    await waitFor(() => button(/Object/))
    fireEvent.click(button(/Object/))
    await waitFor(() => expect(button(/Support/).getAttribute("aria-pressed")).toBe("false"))
    expect(button(/Support/).textContent).toContain("1")
    expect(button(/Object/).textContent).toContain("1")
    await waitFor(() => expect(log).toEqual([`/committee/applicants/71/opinion {"stance":"object"}`]))
  })

  it("rolls back my opinion when saving fails", async () => {
    const server = councilData({ applicants: [golden] })
    stubCouncilApi(server, { admin: false }, [opinionRoute([], server, 500)])
    renderCouncil("/council/applicants")
    const support = await waitFor(() => within(card("GoldenKickWhisper")).getByRole("button", { name: /Support/ }))
    fireEvent.click(support)
    await screen.findByText("Could not save that opinion")
    await waitFor(() => expect(support.getAttribute("aria-pressed")).toBe("false"))
  })

  it("lets only admins approve or reject", async () => {
    stubCouncilApi(councilData({ applicants: [golden] }))
    renderCouncil("/council/applicants")
    await screen.findByRole("article", { name: "GoldenKickWhisper" })
    expect(screen.queryByRole("button", { name: /Approve and add to council/ })).toBeNull()
  })

  function stubDecisions(log: string[]) {
    stubCouncilApi(councilData({ applicants: [golden] }), { admin: true }, [
      {
        match: (url, init) => init?.method === "POST" && url === "/committee/applicants/71/decision",
        respond: (url, init) => {
          log.push(`${url} ${init?.body}`)
          return jsonResponse({ success: true })
        },
      },
    ])
  }

  it("approves an applicant as an admin after a confirmation", async () => {
    const log: string[] = []
    stubDecisions(log)
    renderCouncil("/council/applicants")
    fireEvent.click(await screen.findByRole("button", { name: /Approve and add to council/ }))
    expect(log).toEqual([])
    fireEvent.click(screen.getByRole("button", { name: "Approve GoldenKickWhisper" }))
    await waitFor(() => expect(log).toEqual([`/committee/applicants/71/decision {"decision":"approve"}`]))
    await screen.findByText("Added GoldenKickWhisper to the council")
  })

  it("rejects an applicant as an admin after a confirmation", async () => {
    const log: string[] = []
    stubDecisions(log)
    renderCouncil("/council/applicants")
    fireEvent.click(await screen.findByRole("button", { name: "Reject" }))
    expect(log).toEqual([])
    expect(screen.queryByRole("button", { name: /Approve and add to council/ })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Reject GoldenKickWhisper" }))
    await waitFor(() => expect(log).toEqual([`/committee/applicants/71/decision {"decision":"reject"}`]))
  })

  it("sends nothing when the admin cancels the confirmation", async () => {
    const log: string[] = []
    stubDecisions(log)
    renderCouncil("/council/applicants")
    fireEvent.click(await screen.findByRole("button", { name: "Reject" }))
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy()
    expect(screen.getByRole("button", { name: /Approve and add to council/ })).toBeTruthy()
    expect(log).toEqual([])
  })

  describe("edge cases", () => {
    it("says so when nobody is waiting", async () => {
      stubCouncilApi(councilData({ applicants: [] }))
      renderCouncil("/council/applicants")
      await screen.findByText("No applicants waiting")
    })

    it("shows an applicant without a score", async () => {
      stubCouncilApi(councilData({ applicants: [{ ...golden, score: null, breakdown: [] }] }))
      renderCouncil("/council/applicants")
      await screen.findByRole("article", { name: "GoldenKickWhisper" })
      expect(within(card("GoldenKickWhisper")).queryByRole("meter")).toBeNull()
    })
  })
})
