import { clearStoredSession } from "@/lib/auth"
import { AUTHED_FETCH_ERRORS, AuthedFetchError } from "@/lib/authedFetch"
import {
  createBookmark,
  decideEdit,
  rejectLyric,
  releaseBookmark,
  sealLyric,
  undoRejectLyric,
  unsealLyric,
} from "@/lib/council-api"
import type { BookmarkItemType, BookmarkView, EditItem, EditsPayload, QueueItem } from "@/lib/council-types"
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

export type Decision =
  | { kind: "seal"; item: QueueItem }
  | { kind: "reject"; item: QueueItem; note: string | null }
  | { kind: "approve-edit"; item: EditItem }
  | { kind: "reject-edit"; item: EditItem; note: string | null }

const DONE: Record<Decision["kind"], { message: string; undo?: string; failed: string }> = {
  seal: { message: "Sealed", undo: "Seal lifted from", failed: "seal the lyric" },
  reject: { message: "Rejected", undo: "Rejection undone for", failed: "reject the lyric" },
  "approve-edit": { message: "Approved the edit to", failed: "approve the edit" },
  "reject-edit": { message: "Rejected the edit to", failed: "reject the edit" },
}

function send(decision: Decision): Promise<void> {
  switch (decision.kind) {
    case "seal":
      return sealLyric(decision.item.id)
    case "reject":
      return rejectLyric(decision.item.id, decision.note)
    case "approve-edit":
      return decideEdit(decision.item.lyricsId, decision.item.revisionId, "approve")
    case "reject-edit":
      return decideEdit(decision.item.lyricsId, decision.item.revisionId, "reject", decision.note)
  }
}

function undoOf(decision: Decision): (() => Promise<void>) | null {
  if (decision.kind === "seal") return () => unsealLyric(decision.item.id)
  if (decision.kind === "reject") return () => undoRejectLyric(decision.item.id)
  return null
}

function isQueueDecision(decision: Decision): decision is Extract<Decision, { item: QueueItem }> {
  return decision.kind === "seal" || decision.kind === "reject"
}

function refreshCouncil(client: QueryClient): void {
  client.invalidateQueries({ queryKey: councilKeys.all })
}

export function useCouncilDecision() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: send,
    onMutate: async (decision) => {
      if (isQueueDecision(decision)) {
        await client.cancelQueries({ queryKey: councilKeys.queue })
        const queue = client.getQueryData<QueueItem[]>(councilKeys.queue)
        client.setQueryData<QueueItem[]>(councilKeys.queue, (items) => items?.filter((i) => i.id !== decision.item.id))
        return { queue }
      }
      await client.cancelQueries({ queryKey: councilKeys.edits })
      const edits = client.getQueryData<EditsPayload>(councilKeys.edits)
      client.setQueryData<EditsPayload>(councilKeys.edits, (payload) =>
        payload
          ? { ...payload, items: payload.items.filter((e) => e.revisionId !== decision.item.revisionId) }
          : payload,
      )
      return { edits }
    },
    onError: (error, decision, snapshot) => {
      if (snapshot?.queue) client.setQueryData(councilKeys.queue, snapshot.queue)
      if (snapshot?.edits) client.setQueryData(councilKeys.edits, snapshot.edits)
      councilErrorToast(error, DONE[decision.kind].failed)
    },
    onSuccess: (_, decision) => {
      const done = DONE[decision.kind]
      const undo = undoOf(decision)
      pushToast({
        kind: "info",
        message: `${done.message} “${decision.item.song}”`,
        action: undo
          ? {
              label: "Undo",
              onAction: () => {
                undo().then(
                  () => {
                    pushToast({ kind: "info", message: `${done.undo} “${decision.item.song}”` })
                    refreshCouncil(client)
                  },
                  (error) => councilErrorToast(error, "undo the decision"),
                )
              },
            }
          : undefined,
      })
    },
    onSettled: () => refreshCouncil(client),
  })
}
