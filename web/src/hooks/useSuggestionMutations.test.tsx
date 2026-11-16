import { QueryProvider, createQueryClient } from "@/lib/queryClient"
import type { SuggestionInboxItem } from "@/lib/revision-types"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { councilKeys } from "./useCouncilData"
import { useSuggestionDecision } from "./useSuggestionMutations"

const NOW = Math.floor(Date.now() / 1000)

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
    createdAt: NOW - 8 * 86400,
    councilDecidesAt: null,
    rejectNoteMaxLength: 1000,
  },
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }))),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("useSuggestionDecision", () => {
  it("regression: a decision on the song page marks the council lists stale", async () => {
    const client = createQueryClient()
    client.setQueryData(councilKeys.edits, { items: [] })
    client.setQueryData(councilKeys.overview("council"), {})
    const wrapper = ({ children }: { children: ReactNode }) => <QueryProvider client={client}>{children}</QueryProvider>
    const { result } = renderHook(() => useSuggestionDecision(ITEM.suggestion.id), { wrapper })

    await act(() => result.current.mutateAsync({ kind: "approve", item: ITEM }))

    await waitFor(() => {
      expect(client.getQueryState(councilKeys.edits)?.isInvalidated).toBe(true)
      expect(client.getQueryState(councilKeys.overview("council"))?.isInvalidated).toBe(true)
    })
  })
})
