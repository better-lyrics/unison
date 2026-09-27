import { clearStoredSession } from "@/lib/auth"
import { AUTHED_FETCH_ERRORS, AuthedFetchError } from "@/lib/authedFetch"
import { createBookmark, releaseBookmark } from "@/lib/council-api"
import type { BookmarkItemType, BookmarkView, EditsPayload, QueueItem } from "@/lib/council-types"
import { pushToast } from "@/lib/toast"
import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query"
import { councilKeys } from "./useCouncilData"

export function councilErrorToast(error: unknown, action: string): void {
  const message = error instanceof Error ? error.message : ""
  if (message === AUTHED_FETCH_ERRORS.AUTH_REQUIRED) {
    clearStoredSession()
    pushToast({ kind: "error", message: "Sign in again to continue" })
    return
  }
  if (message === AUTHED_FETCH_ERRORS.RATE_LIMITED) {
    pushToast({ kind: "error", message: "Too many council actions. Try again in a minute." })
    return
  }
  const known = message !== "" && message !== AUTHED_FETCH_ERRORS.REQUEST_FAILED
  pushToast({
    kind: "error",
    message: known ? message : `Could not ${action}. Try again.`,
    detail: error instanceof AuthedFetchError ? (error.hint ?? undefined) : undefined,
  })
}

export function patchBookmark(
  client: QueryClient,
  itemType: BookmarkItemType,
  itemId: number,
  bookmark: BookmarkView | null,
): void {
  if (itemType === "seal") {
    client.setQueryData<QueueItem[]>(councilKeys.queue, (items) =>
      items?.map((i) => (i.id === itemId ? { ...i, bookmark } : i)),
    )
  } else {
    client.setQueryData<EditsPayload>(councilKeys.edits, (payload) =>
      payload
        ? { ...payload, items: payload.items.map((e) => (e.revisionId === itemId ? { ...e, bookmark } : e)) }
        : payload,
    )
  }
}

export interface BookmarkTarget {
  itemType: BookmarkItemType
  itemId: number
  bookmark: BookmarkView | null
  meKeyId: string
}

export function useBookmarkToggle() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (target: BookmarkTarget): Promise<BookmarkView | null> => {
      if (target.bookmark?.holder.keyId === target.meKeyId) {
        await releaseBookmark(target.bookmark.id)
        return null
      }
      const { id, holder, createdAt, expiresAt } = await createBookmark(target.itemType, target.itemId)
      return { id, holder, createdAt, expiresAt }
    },
    onMutate: (target) => {
      if (target.bookmark?.holder.keyId === target.meKeyId) patchBookmark(client, target.itemType, target.itemId, null)
    },
    onSuccess: (bookmark, target) => patchBookmark(client, target.itemType, target.itemId, bookmark),
    onError: (error, target) => {
      patchBookmark(client, target.itemType, target.itemId, target.bookmark)
      councilErrorToast(error, "update the bookmark")
    },
    onSettled: () => {
      client.invalidateQueries({ queryKey: councilKeys.queue })
      client.invalidateQueries({ queryKey: councilKeys.edits })
    },
  })
}
