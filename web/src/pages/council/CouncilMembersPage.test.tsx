import { __resetToastStore } from "@/lib/toast"
import { ME, NOW, OLA, councilData, rosterMember, stubCouncilApi } from "@/test/council-fixtures"
import { jsonResponse } from "@/test/fetch-router"
import { renderCouncil } from "@/test/render-council"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const DAY = 86400
const ADO = { ...OLA, userId: 3, keyId: "0a".repeat(32), displayName: "Ado", tier: null }

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

function data() {
  return councilData({
    members: [
      rosterMember(ME, { lastActiveAt: NOW - 3600, quota: { quota: 3, used: 1, remaining: 2, resetsAt: NOW } }),
      rosterMember(OLA, {
        isAdmin: true,
        lastActiveAt: NOW - 5 * DAY,
        weekly: [9, 9, 9, 9, 9, 9, 9, 9],
        quota: { quota: 3, used: 2, remaining: 1, resetsAt: NOW },
      }),
      rosterMember(ADO, { lastActiveAt: NOW - 23 * DAY, weekly: [2, 1, 0, 0, 0, 0, 0, 0] }),
    ],
  })
}

const names = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell")[0].textContent)

describe("CouncilMembersPage", () => {
  it("lists members by last activity with quota, counts and an inactive warning", async () => {
    stubCouncilApi(data())
    renderCouncil("/council/members")
    await waitFor(() => expect(names()).toEqual(["boiduYOU", "olafix52Admin", "Ado"]))
    expect(screen.getByRole("img", { name: "2 of 3 seals used" })).toBeTruthy()
    expect(screen.getByText("Inactive 3w")).toBeTruthy()
    expect(
      screen.getByText("3 council members. Quotas scale with leaderboard tier and reset on the 1st of each month."),
    ).toBeTruthy()
  })

  it("sorts by decisions and by seals", async () => {
    stubCouncilApi(data())
    renderCouncil("/council/members")
    await waitFor(() => expect(names()).toHaveLength(3))
    fireEvent.click(screen.getByRole("button", { name: "Decisions, 8 weeks" }))
    expect(names()).toEqual(["olafix52Admin", "boiduYOU", "Ado"])
    expect(screen.getByRole("columnheader", { name: /Decisions, 8 weeks/ }).getAttribute("aria-sort")).toBe(
      "descending",
    )
    fireEvent.click(screen.getByRole("button", { name: "Seals this month" }))
    expect(names()[0]).toBe("olafix52Admin")
  })

  it("hides member management from non-admins", async () => {
    stubCouncilApi(data())
    renderCouncil("/council/members")
    await waitFor(() => expect(names()).toHaveLength(3))
    expect(screen.queryByRole("button", { name: /Add member/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull()
  })

  it("adds a member by handle as an admin", async () => {
    const log: string[] = []
    stubCouncilApi(data(), { admin: true }, [
      {
        match: (url) => url === "/users/by-handle/susiisthebest",
        respond: () => jsonResponse({ success: true, data: { keyId: "5e".repeat(32) } }),
      },
      {
        match: (url, init) => url === "/committee/members" && init?.method === "POST",
        respond: (_, init) => {
          log.push(String(init?.body))
          return jsonResponse({ success: true, data: { keyId: "5e".repeat(32) } })
        },
      },
    ])
    renderCouncil("/council/members")
    fireEvent.click(await screen.findByRole("button", { name: /Add member/ }))
    fireEvent.change(screen.getByLabelText("Handle or key id"), { target: { value: "@susiisthebest" } })
    fireEvent.click(screen.getByRole("button", { name: "Add to council" }))
    await waitFor(() => expect(log).toEqual([JSON.stringify({ keyId: "5e".repeat(32) })]))
    await screen.findByText("Added susiisthebest to the council")
    expect(screen.queryByLabelText("Handle or key id")).toBeNull()
  })

  it("explains an unknown handle and an empty entry", async () => {
    stubCouncilApi(data(), { admin: true }, [
      {
        match: (url) => url.startsWith("/users/by-handle/"),
        respond: () => jsonResponse({ success: false, error: "Not found" }, 404),
      },
    ])
    renderCouncil("/council/members")
    fireEvent.click(await screen.findByRole("button", { name: /Add member/ }))
    fireEvent.click(screen.getByRole("button", { name: "Add to council" }))
    expect(screen.getByText("Enter a handle or a 64 character key id.")).toBeTruthy()
    expect(screen.getByLabelText("Handle or key id").getAttribute("aria-invalid")).toBe("true")
    fireEvent.change(screen.getByLabelText("Handle or key id"), { target: { value: "nobody" } })
    fireEvent.click(screen.getByRole("button", { name: "Add to council" }))
    await screen.findByText("No account uses the handle nobody")
  })

  it("regression: does not blame the handle when the lookup itself fails", async () => {
    stubCouncilApi(data(), { admin: true }, [
      {
        match: (url) => url.startsWith("/users/by-handle/"),
        respond: () => jsonResponse({ success: false, error: "Internal error" }, 500),
      },
    ])
    renderCouncil("/council/members")
    fireEvent.click(await screen.findByRole("button", { name: /Add member/ }))
    fireEvent.change(screen.getByLabelText("Handle or key id"), { target: { value: "susiisthebest" } })
    fireEvent.click(screen.getByRole("button", { name: "Add to council" }))
    await screen.findByText("Could not add the member. Try again.")
    expect(screen.queryByText(/No account uses the handle/)).toBeNull()
  })

  it("removes a member after a confirmation, never myself", async () => {
    const log: string[] = []
    stubCouncilApi(data(), { admin: true }, [
      {
        match: (url, init) => init?.method === "DELETE" && url.startsWith("/committee/members/"),
        respond: (url) => {
          log.push(url)
          return jsonResponse({ success: true })
        },
      },
    ])
    renderCouncil("/council/members")
    await waitFor(() => expect(names()).toHaveLength(3))
    expect(screen.queryByRole("button", { name: "Remove boidu from the council" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Remove olafix52 from the council" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Remove Ado from the council" }))
    fireEvent.click(screen.getByRole("button", { name: "Remove Ado" }))
    await waitFor(() => expect(log).toEqual([`/committee/members/${ADO.keyId}`]))
    await screen.findByText("Removed Ado from the council")
  })
})
