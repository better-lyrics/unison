import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sessionMock = vi.fn()
const queueMock = vi.fn()
const editsMock = vi.fn()

vi.mock("@/auth/useSession", () => ({ useSession: () => sessionMock() }))
vi.mock("@/lib/council-api", () => ({
  fetchCouncilQueue: () => queueMock(),
  fetchCouncilEdits: () => editsMock(),
}))

import { CouncilNavLink } from "./CouncilNavLink"

const signedIn = (council: { admin: boolean } | null) => ({
  status: "signed-in",
  identity: { keyId: "k", displayName: "Mira", expiresAt: 9e9, council },
})

function renderLink() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <CouncilNavLink className={() => "tab"} />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

const item = (bookmarked: boolean) => ({
  id: Math.random(),
  bookmark: bookmarked ? { id: 1, expiresAt: Math.floor(Date.now() / 1000) + 3600 } : null,
})

beforeEach(() => {
  queueMock.mockResolvedValue([item(false), item(false), item(true)])
  editsMock.mockResolvedValue({ items: [item(false)], thresholds: {} })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("CouncilNavLink", () => {
  it("renders nothing for a signed-out visitor or a non-member", () => {
    sessionMock.mockReturnValue({ status: "signed-out" })
    renderLink()
    expect(screen.queryByRole("link")).toBeNull()
    cleanup()
    sessionMock.mockReturnValue(signedIn(null))
    renderLink()
    expect(screen.queryByRole("link")).toBeNull()
    expect(queueMock).not.toHaveBeenCalled()
  })

  it("links members to the dashboard with the count of open work", async () => {
    sessionMock.mockReturnValue(signedIn({ admin: false }))
    renderLink()
    const link = screen.getByRole("link", { name: /council/i })
    expect(link.getAttribute("href")).toBe("/council")
    await waitFor(() => expect(screen.getByText("3")).toBeTruthy())
    expect(link.getAttribute("aria-label")).toBe("Council, 3 open items")
  })

  it("hides the count when nothing is open", async () => {
    sessionMock.mockReturnValue(signedIn({ admin: true }))
    queueMock.mockResolvedValue([])
    editsMock.mockResolvedValue({ items: [], thresholds: {} })
    renderLink()
    await waitFor(() => expect(queueMock).toHaveBeenCalled())
    expect(screen.getByRole("link").textContent).toBe("Council")
  })
})
