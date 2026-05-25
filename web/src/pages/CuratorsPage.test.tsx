import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/auth/AuthProvider"
import { saveStoredSession, type StoredSession } from "@/lib/auth"
import { CuratorsPage } from "./CuratorsPage"

const ownKeyId = "k".repeat(64)
const otherKeyId = "z".repeat(64)
const valid: StoredSession = {
  sessionToken: "tok",
  keyId: ownKeyId,
  displayName: "BrightVivaceRoll",
  expiresAt: Math.floor(Date.now() / 1000) + 1000,
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
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/auth/me") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: { keyId: ownKeyId, displayName: valid.displayName, expiresAt: valid.expiresAt },
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
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
          { status: 200 },
        ),
      )
    })
    vi.stubGlobal("fetch", fetchMock)
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
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
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
          { status: 200 },
        ),
      ),
    )
    const { container } = renderPage()
    await waitFor(() => expect(screen.getByText("Anyone")).toBeTruthy())
    expect(container.querySelector('[data-self="true"]')).toBeNull()
  })
})
