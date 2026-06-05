import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { VariantFull, VariantSummary } from "@/lib/types"

const voteVariant = vi.fn()
const unvoteVariant = vi.fn()
const reportVariant = vi.fn()

vi.mock("@/lib/api", () => ({
  voteVariant: (...args: unknown[]) => voteVariant(...args),
  unvoteVariant: (...args: unknown[]) => unvoteVariant(...args),
  reportVariant: (...args: unknown[]) => reportVariant(...args),
}))

const clearStoredSession = vi.fn()

vi.mock("@/lib/auth", () => ({
  clearStoredSession: () => clearStoredSession(),
}))

import { useVoteMutations } from "./useVoteMutations"
import { __resetToastStore, useToasts } from "@/lib/toast"

interface SeedOptions {
  variantId: number
  videoId: string
  userVote: 1 | -1 | null
  voteCount: number
}

function makeSummary(opts: SeedOptions): VariantSummary {
  return {
    id: opts.variantId,
    videoId: opts.videoId,
    song: "Song",
    artist: "Artist",
    format: "ttml",
    syncType: "richsync",
    score: 1,
    effectiveScore: 1.5,
    voteCount: opts.voteCount,
    confidence: "medium",
    hidden: false,
    userVote: opts.userVote,
  }
}

function makeFull(opts: SeedOptions): VariantFull {
  return { ...makeSummary(opts), lyrics: "<tt></tt>" }
}

function createWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

function seedCaches(client: QueryClient, opts: SeedOptions) {
  client.setQueryData(["lyrics", "variants", opts.videoId], { variants: [makeSummary(opts)] })
  client.setQueryData(["lyrics", "variant", opts.variantId], { variant: makeFull(opts) })
}

function readVariantsCache(client: QueryClient, videoId: string): { variants: VariantSummary[] } | undefined {
  return client.getQueryData(["lyrics", "variants", videoId])
}

function readVariantCache(client: QueryClient, variantId: number): { variant: VariantFull } | undefined {
  return client.getQueryData(["lyrics", "variant", variantId])
}

let client: QueryClient

beforeEach(() => {
  voteVariant.mockReset()
  unvoteVariant.mockReset()
  reportVariant.mockReset()
  clearStoredSession.mockReset()
  __resetToastStore()
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  })
})

afterEach(() => {
  __resetToastStore()
})

describe("useVoteMutations", () => {
  it("upvote when userVote is null calls voteVariant(1) with optimistic cache updates", async () => {
    seedCaches(client, { variantId: 1, videoId: "v1", userVote: null, voteCount: 5 })
    voteVariant.mockResolvedValue(undefined)
    const { result } = renderHook(() => useVoteMutations({ variantId: 1, videoId: "v1" }), {
      wrapper: createWrapper(client),
    })

    act(() => {
      result.current.upvote()
    })

    const variants = readVariantsCache(client, "v1")
    expect(variants?.variants[0]?.userVote).toBe(1)
    expect(variants?.variants[0]?.voteCount).toBe(6)
    const variant = readVariantCache(client, 1)
    expect(variant?.variant.userVote).toBe(1)
    expect(variant?.variant.voteCount).toBe(6)

    await waitFor(() => expect(voteVariant).toHaveBeenCalledWith(1, 1))
  })

  it("upvote when userVote is already 1 calls unvoteVariant and decrements vote count", async () => {
    seedCaches(client, { variantId: 1, videoId: "v1", userVote: 1, voteCount: 5 })
    unvoteVariant.mockResolvedValue(undefined)
    const { result } = renderHook(() => useVoteMutations({ variantId: 1, videoId: "v1" }), {
      wrapper: createWrapper(client),
    })

    act(() => {
      result.current.upvote()
    })

    const variants = readVariantsCache(client, "v1")
    expect(variants?.variants[0]?.userVote).toBeNull()
    expect(variants?.variants[0]?.voteCount).toBe(4)

    await waitFor(() => expect(unvoteVariant).toHaveBeenCalledWith(1))
    expect(voteVariant).not.toHaveBeenCalled()
  })

  it("upvote when userVote is -1 swings score by 2 and leaves voteCount unchanged", async () => {
    seedCaches(client, { variantId: 1, videoId: "v1", userVote: -1, voteCount: 5 })
    voteVariant.mockResolvedValue(undefined)
    const { result } = renderHook(() => useVoteMutations({ variantId: 1, videoId: "v1" }), {
      wrapper: createWrapper(client),
    })

    act(() => {
      result.current.upvote()
    })

    const variants = readVariantsCache(client, "v1")
    expect(variants?.variants[0]?.userVote).toBe(1)
    expect(variants?.variants[0]?.voteCount).toBe(5)
    expect(variants?.variants[0]?.score).toBe(3)
    const variant = readVariantCache(client, 1)
    expect(variant?.variant.voteCount).toBe(5)
    expect(variant?.variant.score).toBe(3)

    await waitFor(() => expect(voteVariant).toHaveBeenCalledWith(1, 1))
  })

  it("downvote when userVote is null increments voteCount and decrements score", async () => {
    seedCaches(client, { variantId: 1, videoId: "v1", userVote: null, voteCount: 5 })
    voteVariant.mockResolvedValue(undefined)
    const { result } = renderHook(() => useVoteMutations({ variantId: 1, videoId: "v1" }), {
      wrapper: createWrapper(client),
    })

    act(() => {
      result.current.downvote()
    })

    const variants = readVariantsCache(client, "v1")
    expect(variants?.variants[0]?.userVote).toBe(-1)
    expect(variants?.variants[0]?.voteCount).toBe(6)
    expect(variants?.variants[0]?.score).toBe(0)

    await waitFor(() => expect(voteVariant).toHaveBeenCalledWith(1, -1))
  })

  it("unvote when userVote is 1 calls unvoteVariant and decrements vote count", async () => {
    seedCaches(client, { variantId: 1, videoId: "v1", userVote: 1, voteCount: 5 })
    unvoteVariant.mockResolvedValue(undefined)
    const { result } = renderHook(() => useVoteMutations({ variantId: 1, videoId: "v1" }), {
      wrapper: createWrapper(client),
    })

    act(() => {
      result.current.unvote()
    })

    const variants = readVariantsCache(client, "v1")
    expect(variants?.variants[0]?.userVote).toBeNull()
    expect(variants?.variants[0]?.voteCount).toBe(4)

    await waitFor(() => expect(unvoteVariant).toHaveBeenCalledWith(1))
  })

  it("rolls back both caches when the mutation rejects", async () => {
    seedCaches(client, { variantId: 1, videoId: "v1", userVote: null, voteCount: 5 })
    voteVariant.mockRejectedValue(new Error("boom"))
    const { result } = renderHook(() => useVoteMutations({ variantId: 1, videoId: "v1" }), {
      wrapper: createWrapper(client),
    })

    act(() => {
      result.current.upvote()
    })

    await waitFor(() => {
      const variants = readVariantsCache(client, "v1")
      expect(variants?.variants[0]?.userVote).toBeNull()
      expect(variants?.variants[0]?.voteCount).toBe(5)
    })
    const variant = readVariantCache(client, 1)
    expect(variant?.variant.userVote).toBeNull()
    expect(variant?.variant.voteCount).toBe(5)
  })

  it("invalidates both query keys on settle", async () => {
    seedCaches(client, { variantId: 1, videoId: "v1", userVote: null, voteCount: 5 })
    voteVariant.mockResolvedValue(undefined)
    const invalidateSpy = vi.spyOn(client, "invalidateQueries")
    const { result } = renderHook(() => useVoteMutations({ variantId: 1, videoId: "v1" }), {
      wrapper: createWrapper(client),
    })

    act(() => {
      result.current.upvote()
    })

    await waitFor(() => expect(voteVariant).toHaveBeenCalled())
    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey)
      expect(keys).toContainEqual(["lyrics", "variants", "v1"])
      expect(keys).toContainEqual(["lyrics", "variant", 1])
    })
  })

  it("report calls reportVariant and pushes a success toast", async () => {
    seedCaches(client, { variantId: 1, videoId: "v1", userVote: null, voteCount: 5 })
    reportVariant.mockResolvedValue(undefined)
    const { result: toastResult } = renderHook(() => useToasts())
    const { result } = renderHook(() => useVoteMutations({ variantId: 1, videoId: "v1" }), {
      wrapper: createWrapper(client),
    })

    act(() => {
      result.current.report("spam")
    })

    await waitFor(() => expect(reportVariant).toHaveBeenCalledWith(1, "spam"))
    await waitFor(() => expect(toastResult.current.some((t) => t.kind === "success")).toBe(true))
  })

  it("report rejection pushes an error toast", async () => {
    seedCaches(client, { variantId: 1, videoId: "v1", userVote: null, voteCount: 5 })
    reportVariant.mockRejectedValue(new Error("nope"))
    const { result: toastResult } = renderHook(() => useToasts())
    const { result } = renderHook(() => useVoteMutations({ variantId: 1, videoId: "v1" }), {
      wrapper: createWrapper(client),
    })

    act(() => {
      result.current.report("other")
    })

    await waitFor(() =>
      expect(toastResult.current.some((t) => t.kind === "error" && t.message.includes("nope"))).toBe(true),
    )
  })

  it("AUTH_REQUIRED clears the stored session and pushes a sign-in toast", async () => {
    seedCaches(client, { variantId: 1, videoId: "v1", userVote: null, voteCount: 5 })
    voteVariant.mockRejectedValue(new Error("AUTH_REQUIRED"))
    const { result: toastResult } = renderHook(() => useToasts())
    const { result } = renderHook(() => useVoteMutations({ variantId: 1, videoId: "v1" }), {
      wrapper: createWrapper(client),
    })

    act(() => {
      result.current.upvote()
    })

    await waitFor(() => expect(clearStoredSession).toHaveBeenCalled())
    expect(toastResult.current.some((t) => t.message.toLowerCase().includes("sign in"))).toBe(true)
  })

  it("RATE_LIMITED pushes the rate-limit toast", async () => {
    seedCaches(client, { variantId: 1, videoId: "v1", userVote: null, voteCount: 5 })
    voteVariant.mockRejectedValue(new Error("RATE_LIMITED"))
    const { result: toastResult } = renderHook(() => useToasts())
    const { result } = renderHook(() => useVoteMutations({ variantId: 1, videoId: "v1" }), {
      wrapper: createWrapper(client),
    })

    act(() => {
      result.current.upvote()
    })

    await waitFor(() =>
      expect(toastResult.current.some((t) => t.kind === "error" && t.message.toLowerCase().includes("too many"))).toBe(
        true,
      ),
    )
  })
})
