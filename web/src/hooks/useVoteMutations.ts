import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"
import { reportVariant, unvoteVariant, voteVariant } from "@/lib/api"
import { clearStoredSession } from "@/lib/auth"
import { AUTHED_FETCH_ERRORS } from "@/lib/authedFetch"
import { pushToast } from "@/lib/toast"
import type { VariantFull, VariantSummary } from "@/lib/types"

export type ReportReason = "wrong_song" | "bad_sync" | "offensive" | "spam" | "other"

export interface UseVoteMutationsArgs {
  variantId: number
  videoId: string
}

export interface UseVoteMutationsResult {
  upvote: () => void
  downvote: () => void
  unvote: () => void
  report: (reason: ReportReason) => void
  isPending: boolean
}

type VariantsCache = { variants: VariantSummary[] } | undefined
type VariantCache = { variant: VariantFull } | undefined

interface RollbackSnapshot {
  variants: VariantsCache
  variant: VariantCache
}

interface VoteDeltas {
  voteCount: number
  score: number
}

function computeVoteDeltas(prev: 1 | -1 | null | undefined, next: 1 | -1 | null): VoteDeltas {
  const prevValue = prev ?? null
  if (prevValue === next) return { voteCount: 0, score: 0 }
  if (prevValue === null && next !== null) return { voteCount: 1, score: next }
  if (next === null && prevValue !== null) return { voteCount: -1, score: -prevValue }
  if (prevValue !== null && next !== null) return { voteCount: 0, score: 2 * next }
  return { voteCount: 0, score: 0 }
}

function applyVoteToVariants(cache: VariantsCache, variantId: number, next: 1 | -1 | null): VariantsCache {
  if (!cache) return cache
  return {
    variants: cache.variants.map((v) => {
      if (v.id !== variantId) return v
      const d = computeVoteDeltas(v.userVote, next)
      return { ...v, userVote: next, voteCount: v.voteCount + d.voteCount, score: v.score + d.score }
    }),
  }
}

function applyVoteToVariant(cache: VariantCache, variantId: number, next: 1 | -1 | null): VariantCache {
  if (!cache) return cache
  if (cache.variant.id !== variantId) return cache
  const d = computeVoteDeltas(cache.variant.userVote, next)
  return {
    variant: {
      ...cache.variant,
      userVote: next,
      voteCount: cache.variant.voteCount + d.voteCount,
      score: cache.variant.score + d.score,
    },
  }
}

function currentUserVote(cache: VariantCache, fallback: VariantsCache, variantId: number): 1 | -1 | null {
  if (cache?.variant.id === variantId) return cache.variant.userVote ?? null
  const match = fallback?.variants.find((v) => v.id === variantId)
  return match?.userVote ?? null
}

function handleErrorToast(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  if (message === AUTHED_FETCH_ERRORS.AUTH_REQUIRED) {
    clearStoredSession()
    pushToast({ kind: "error", message: "Sign in again to vote" })
    return
  }
  if (message === AUTHED_FETCH_ERRORS.RATE_LIMITED) {
    pushToast({ kind: "error", message: "Too many votes. Try again in a moment." })
    return
  }
  pushToast({ kind: "error", message: message.length > 0 ? message : "Something went wrong" })
}

export function useVoteMutations(args: UseVoteMutationsArgs): UseVoteMutationsResult {
  const { variantId, videoId } = args
  const queryClient = useQueryClient()
  const variantsKey = ["lyrics", "variants", videoId] as const
  const variantKey = ["lyrics", "variant", variantId] as const

  const settle = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: variantsKey })
    queryClient.invalidateQueries({ queryKey: variantKey })
  }, [queryClient, variantsKey, variantKey])

  const snapshot = useCallback((): RollbackSnapshot => {
    return {
      variants: queryClient.getQueryData<VariantsCache>(variantsKey),
      variant: queryClient.getQueryData<VariantCache>(variantKey),
    }
  }, [queryClient, variantsKey, variantKey])

  const writeOptimistic = useCallback(
    (next: 1 | -1 | null) => {
      queryClient.setQueryData<VariantsCache>(variantsKey, (prev) => applyVoteToVariants(prev, variantId, next))
      queryClient.setQueryData<VariantCache>(variantKey, (prev) => applyVoteToVariant(prev, variantId, next))
    },
    [queryClient, variantsKey, variantKey, variantId],
  )

  const restore = useCallback(
    (snap: RollbackSnapshot) => {
      queryClient.setQueryData(variantsKey, snap.variants)
      queryClient.setQueryData(variantKey, snap.variant)
    },
    [queryClient, variantsKey, variantKey],
  )

  const voteMutation = useMutation<void, Error, 1 | -1, RollbackSnapshot>({
    mutationFn: (value) => voteVariant(variantId, value),
    onMutate: async (value) => {
      const snap = snapshot()
      writeOptimistic(value)
      return snap
    },
    onError: (err, _value, snap) => {
      if (snap) restore(snap)
      handleErrorToast(err)
    },
    onSettled: settle,
  })

  const unvoteMutation = useMutation<void, Error, void, RollbackSnapshot>({
    mutationFn: () => unvoteVariant(variantId),
    onMutate: async () => {
      const snap = snapshot()
      writeOptimistic(null)
      return snap
    },
    onError: (err, _value, snap) => {
      if (snap) restore(snap)
      handleErrorToast(err)
    },
    onSettled: settle,
  })

  const reportMutation = useMutation<void, Error, ReportReason>({
    mutationFn: (reason) => reportVariant(variantId, reason),
    onSuccess: () => {
      pushToast({ kind: "success", message: "Report submitted" })
    },
    onError: (err) => {
      handleErrorToast(err)
    },
  })

  const upvote = useCallback(() => {
    const prev = currentUserVote(
      queryClient.getQueryData<VariantCache>(variantKey),
      queryClient.getQueryData<VariantsCache>(variantsKey),
      variantId,
    )
    if (prev === 1) unvoteMutation.mutate()
    else voteMutation.mutate(1)
  }, [queryClient, variantKey, variantsKey, variantId, unvoteMutation, voteMutation])

  const downvote = useCallback(() => {
    const prev = currentUserVote(
      queryClient.getQueryData<VariantCache>(variantKey),
      queryClient.getQueryData<VariantsCache>(variantsKey),
      variantId,
    )
    if (prev === -1) unvoteMutation.mutate()
    else voteMutation.mutate(-1)
  }, [queryClient, variantKey, variantsKey, variantId, unvoteMutation, voteMutation])

  const unvote = useCallback(() => {
    unvoteMutation.mutate()
  }, [unvoteMutation])

  const report = useCallback(
    (reason: ReportReason) => {
      reportMutation.mutate(reason)
    },
    [reportMutation],
  )

  return {
    upvote,
    downvote,
    unvote,
    report,
    isPending: voteMutation.isPending || unvoteMutation.isPending || reportMutation.isPending,
  }
}
