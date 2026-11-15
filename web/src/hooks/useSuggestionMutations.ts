import { previewRevision, submitRevision, withdrawPendingRevision } from "@/lib/api"
import { decideEdit } from "@/lib/council-api"
import { focusPageHeading } from "@/lib/dom"
import { suggestionErrorMessage } from "@/lib/lyric-suggestion"
import type { RevisionInput, SuggestionInboxItem } from "@/lib/revision-types"
import { pushToast } from "@/lib/toast"
import { type QueryClient, useMutation, useMutationState, useQueryClient } from "@tanstack/react-query"
import { lyricsKeys } from "./useLyricsData"

interface LyricRef {
  lyricsId: number
  videoId: string
}

function refreshLyric(client: QueryClient, { lyricsId, videoId }: LyricRef): void {
  client.invalidateQueries({ queryKey: lyricsKeys.allSuggestions })
  client.invalidateQueries({ queryKey: lyricsKeys.variants(videoId) })
  client.invalidateQueries({ queryKey: lyricsKeys.variant(lyricsId) })
  client.invalidateQueries({ queryKey: lyricsKeys.revisions(lyricsId) })
}

const actionKey = (suggestionId: number | undefined) => ["suggestion-action", suggestionId] as const

export function useActedOnSuggestion(suggestionId: number | undefined): boolean {
  return useMutationState({ filters: { mutationKey: actionKey(suggestionId), status: "success" } }).length > 0
}

export function usePreviewSuggestion(lyricsId: number) {
  return useMutation({ mutationFn: (input: RevisionInput) => previewRevision(lyricsId, input) })
}

export function useSendSuggestion(lyric: LyricRef) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ input, note }: { input: RevisionInput; note: string }) => {
      const trimmed = note.trim()
      return submitRevision(lyric.lyricsId, trimmed === "" ? input : { ...input, note: trimmed })
    },
    onSettled: () => refreshLyric(client, lyric),
  })
}

export function useWithdrawSuggestion(lyric: LyricRef, suggestionId: number | undefined) {
  const client = useQueryClient()
  return useMutation({
    mutationKey: actionKey(suggestionId),
    mutationFn: () => withdrawPendingRevision(lyric.lyricsId),
    onSuccess: () => {
      focusPageHeading()
      pushToast({ kind: "info", message: "Suggestion withdrawn" })
    },
    onError: (error) => pushToast({ kind: "error", message: suggestionErrorMessage(error) }),
    onSettled: () => refreshLyric(client, lyric),
  })
}

export type SuggestionDecision =
  | { kind: "approve"; item: SuggestionInboxItem }
  | { kind: "reject"; item: SuggestionInboxItem; note: string | null }

export function useSuggestionDecision(suggestionId: number) {
  const client = useQueryClient()
  return useMutation({
    mutationKey: actionKey(suggestionId),
    mutationFn: (decision: SuggestionDecision) =>
      decideEdit(
        decision.item.lyricsId,
        decision.item.suggestion.id,
        decision.kind,
        decision.kind === "reject" ? decision.note : null,
      ),
    onSuccess: (_, { kind, item }) => {
      focusPageHeading()
      pushToast({
        kind: "info",
        message: `${kind === "approve" ? "Approved" : "Rejected"} the suggestion for “${item.song}”`,
      })
    },
    onError: (error) => pushToast({ kind: "error", message: suggestionErrorMessage(error) }),
    onSettled: (_, __, { item }) => refreshLyric(client, item),
  })
}
