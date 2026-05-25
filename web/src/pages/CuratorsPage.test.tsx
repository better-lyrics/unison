import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/auth/AuthProvider"
import { saveStoredSession, type StoredSession } from "@/lib/auth"
import { CuratorsPage } from "./CuratorsPage"

const ownKeyId = "k".repeat(64)
const otherKeyId = "z".repeat(64)
const thirdKeyId = "y".repeat(64)
const valid: StoredSession = {
  sessionToken: "tok",
  keyId: ownKeyId,
  displayName: "BrightVivaceRoll",
  expiresAt: Math.floor(Date.now() / 1000) + 1000,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <CuratorsPage />
      </AuthProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe("CuratorsPage", () => {
  it("marks the signed-in user's row with data-self", async () => {
    saveStoredSession(valid)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/auth/me") {
          return Promise.resolve(
            jsonResponse({
              success: true,
              data: { keyId: ownKeyId, displayName: valid.displayName, expiresAt: valid.expiresAt },
            }),
          )
        }
        if (url === "/leaderboard/users") {
          return Promise.resolve(
            jsonResponse({
              success: true,
              data: {
                curators: [
                  {
                    keyId: otherKeyId,
                    displayName: "Other",
                    reputation: 1,
                    score: 9.9,
                    submissionCount: 5,
                    totalUpvotes: 12,
                    rank: 1,
                  },
                  {
                    keyId: ownKeyId,
                    displayName: valid.displayName,
                    reputation: 1,
                    score: 5.5,
                    submissionCount: 2,
                    totalUpvotes: 3,
                    rank: 2,
                  },
                ],
              },
            }),
          )
        }
        if (url === `/leaderboard/users/${ownKeyId}`) {
          return Promise.resolve(
            jsonResponse({
              success: true,
              data: {
                ranked: true,
                keyId: ownKeyId,
                displayName: valid.displayName,
                reputation: 1,
                score: 5.5,
                submissionCount: 2,
                totalUpvotes: 3,
                rank: 2,
              },
            }),
          )
        }
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )
    const { container } = renderPage()
    await waitFor(() => expect(screen.getByText("Other")).toBeTruthy())
    const selfRow = container.querySelector('[data-self="true"]')
    expect(selfRow).toBeTruthy()
    expect(selfRow?.textContent).toContain(valid.displayName)
    expect(selfRow?.textContent?.toLowerCase()).toContain("you")
  })

  it("does not mark any row when signed-out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/leaderboard/users") {
          return Promise.resolve(
            jsonResponse({
              success: true,
              data: {
                curators: [
                  {
                    keyId: ownKeyId,
                    displayName: "Anyone",
                    reputation: 1,
                    score: 5.5,
                    submissionCount: 2,
                    totalUpvotes: 3,
                    rank: 1,
                  },
                ],
              },
            }),
          )
        }
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )
    const { container } = renderPage()
    await waitFor(() => expect(screen.getByText("Anyone")).toBeTruthy())
    expect(container.querySelector('[data-self="true"]')).toBeNull()
  })

  it("appends the signed-in user's row when they're not in the top N", async () => {
    saveStoredSession(valid)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/auth/me") {
          return Promise.resolve(
            jsonResponse({
              success: true,
              data: { keyId: ownKeyId, displayName: valid.displayName, expiresAt: valid.expiresAt },
            }),
          )
        }
        if (url === "/leaderboard/users") {
          return Promise.resolve(
            jsonResponse({
              success: true,
              data: {
                curators: [
                  {
                    keyId: otherKeyId,
                    displayName: "Other",
                    reputation: 1,
                    score: 9.9,
                    submissionCount: 5,
                    totalUpvotes: 12,
                    rank: 1,
                  },
                  {
                    keyId: thirdKeyId,
                    displayName: "Third",
                    reputation: 1,
                    score: 8.8,
                    submissionCount: 4,
                    totalUpvotes: 10,
                    rank: 2,
                  },
                ],
              },
            }),
          )
        }
        if (url === `/leaderboard/users/${ownKeyId}`) {
          return Promise.resolve(
            jsonResponse({
              success: true,
              data: {
                ranked: true,
                keyId: ownKeyId,
                displayName: valid.displayName,
                reputation: 1,
                score: 3.3,
                submissionCount: 1,
                totalUpvotes: 2,
                rank: 99,
              },
            }),
          )
        }
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )
    const { container } = renderPage()
    await waitFor(() => expect(container.querySelector('[data-self="true"]')).toBeTruthy())
    const rows = container.querySelectorAll("ul > li")
    expect(rows).toHaveLength(3)
    expect(screen.getByText("Other")).toBeTruthy()
    expect(screen.getByText("Third")).toBeTruthy()
    const selfRow = container.querySelector('[data-self="true"]')
    expect(selfRow?.textContent).toContain(valid.displayName)
    expect(selfRow?.textContent?.toLowerCase()).toContain("you")
    expect(rows[rows.length - 1]).toBe(selfRow)
    expect(rows[2].className).toContain("mt-4")
  })

  it("does not duplicate the row when the user is already in the top N", async () => {
    saveStoredSession(valid)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/auth/me") {
          return Promise.resolve(
            jsonResponse({
              success: true,
              data: { keyId: ownKeyId, displayName: valid.displayName, expiresAt: valid.expiresAt },
            }),
          )
        }
        if (url === "/leaderboard/users") {
          return Promise.resolve(
            jsonResponse({
              success: true,
              data: {
                curators: [
                  {
                    keyId: ownKeyId,
                    displayName: valid.displayName,
                    reputation: 1,
                    score: 9.9,
                    submissionCount: 5,
                    totalUpvotes: 12,
                    rank: 1,
                  },
                  {
                    keyId: otherKeyId,
                    displayName: "Other",
                    reputation: 1,
                    score: 5.5,
                    submissionCount: 2,
                    totalUpvotes: 3,
                    rank: 2,
                  },
                ],
              },
            }),
          )
        }
        if (url === `/leaderboard/users/${ownKeyId}`) {
          return Promise.resolve(
            jsonResponse({
              success: true,
              data: {
                ranked: true,
                keyId: ownKeyId,
                displayName: valid.displayName,
                reputation: 1,
                score: 9.9,
                submissionCount: 5,
                totalUpvotes: 12,
                rank: 1,
              },
            }),
          )
        }
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )
    const { container } = renderPage()
    await waitFor(() => expect(screen.getByText("Other")).toBeTruthy())
    const rows = container.querySelectorAll("ul > li")
    expect(rows).toHaveLength(2)
    const selfRows = container.querySelectorAll('[data-self="true"]')
    expect(selfRows).toHaveLength(1)
  })

  it("does not append when the user is signed-in but not ranked", async () => {
    saveStoredSession(valid)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/auth/me") {
          return Promise.resolve(
            jsonResponse({
              success: true,
              data: { keyId: ownKeyId, displayName: valid.displayName, expiresAt: valid.expiresAt },
            }),
          )
        }
        if (url === "/leaderboard/users") {
          return Promise.resolve(
            jsonResponse({
              success: true,
              data: {
                curators: [
                  {
                    keyId: otherKeyId,
                    displayName: "Other",
                    reputation: 1,
                    score: 9.9,
                    submissionCount: 5,
                    totalUpvotes: 12,
                    rank: 1,
                  },
                ],
              },
            }),
          )
        }
        if (url === `/leaderboard/users/${ownKeyId}`) {
          return Promise.resolve(jsonResponse({ success: true, data: { ranked: false } }))
        }
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )
    const { container } = renderPage()
    await waitFor(() => expect(screen.getByText("Other")).toBeTruthy())
    const rows = container.querySelectorAll("ul > li")
    expect(rows).toHaveLength(1)
    expect(container.querySelector('[data-self="true"]')).toBeNull()
  })
})
