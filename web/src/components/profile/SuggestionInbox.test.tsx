import { SessionContext } from "@/auth/AuthProvider"
import { saveStoredSession } from "@/lib/auth"
import { QueryProvider, createQueryClient } from "@/lib/queryClient"
import type { SuggestionInboxItem } from "@/lib/revision-types"
import { QueryClient } from "@tanstack/react-query"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SuggestionInbox } from "./SuggestionInbox"

const NOW = Math.floor(Date.now() / 1000)
const FIRST = "a".repeat(64)
const SECOND = "b".repeat(64)

const ITEM: SuggestionInboxItem = {
  lyricsId: 48211,
  videoId: "k4Pw2sLmQ0e",
  song: "Paper Lanterns",
  artist: "Hollow Coast",
  suggestion: {
    id: 9310,
    revNo: 4,
    author: { displayName: "Ren Okafor" },
    authorKeyId: "c".repeat(64),
    authorAvatarUrl: null,
    note: null,
    pendingReason: "suggested",
    sealed: false,
    createdAt: NOW - 3600,
    councilDecidesAt: NOW + 6 * 86400,
  },
}

const sessionOf = (keyId: string) =>
  ({
    status: "signed-in",
    extensionAvailable: true,
    extensionId: null,
    identity: { keyId, displayName: "Aurora Wynter", expiresAt: NOW + 1000 },
    signOut: () => {},
    updateDisplayName: () => {},
    updateAvatarUrl: () => {},
  }) as const

const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200 })

let inboxRequests: string[] = []

function signIn(keyId: string) {
  saveStoredSession({ sessionToken: `token-${keyId}`, keyId, displayName: "Aurora Wynter", expiresAt: NOW + 1000 })
}

beforeEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
  inboxRequests = []
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url !== "/lyrics/mine/suggestions") return Promise.resolve(ok(null))
      const auth = new Headers(init?.headers).get("authorization") ?? ""
      inboxRequests.push(auth)
      return Promise.resolve(ok(auth === `Bearer token-${FIRST}` ? [ITEM] : []))
    }),
  )
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe("SuggestionInbox", () => {
  it("regression: never shows the previous account's suggestions after an account switch", async () => {
    const client = createQueryClient()
    const tree = (keyId: string) => (
      <QueryProvider client={client}>
        <SessionContext.Provider value={sessionOf(keyId)}>
          <MemoryRouter>
            <SuggestionInbox />
          </MemoryRouter>
        </SessionContext.Provider>
      </QueryProvider>
    )
    signIn(FIRST)
    const { rerender } = render(tree(FIRST))
    await waitFor(() => expect(screen.getByText(ITEM.song)).toBeTruthy())

    signIn(SECOND)
    rerender(tree(SECOND))
    expect(screen.queryByText(ITEM.song)).toBeNull()
    await waitFor(() => expect(inboxRequests).toEqual([`Bearer token-${FIRST}`, `Bearer token-${SECOND}`]))
    expect(screen.queryByText(ITEM.song)).toBeNull()
  })

  it("regression: keeps the section on screen with a retry when the inbox fails to load", async () => {
    let failing = true
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url !== "/lyrics/mine/suggestions") return Promise.resolve(ok(null))
        if (failing) return Promise.resolve(new Response("{}", { status: 500 }))
        return Promise.resolve(ok([ITEM]))
      }),
    )
    signIn(FIRST)
    render(
      <QueryProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SessionContext.Provider value={sessionOf(FIRST)}>
          <MemoryRouter>
            <SuggestionInbox />
          </MemoryRouter>
        </SessionContext.Provider>
      </QueryProvider>,
    )
    await waitFor(() =>
      expect(screen.getByText("Could not load the suggestions on your lyrics. Try again.")).toBeTruthy(),
    )
    failing = false
    await act(async () => {
      screen.getByRole("button", { name: "Try again" }).click()
    })
    await waitFor(() => expect(screen.getByText(ITEM.song)).toBeTruthy())
  })
})
