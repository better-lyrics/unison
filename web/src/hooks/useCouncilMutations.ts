import { fetchUserByHandle, isNotFound } from "@/lib/api"
import { clearStoredSession } from "@/lib/auth"
import { AUTHED_FETCH_ERRORS, AuthedFetchError } from "@/lib/authedFetch"
import {
  addCouncilMember,
  createBookmark,
  decideApplicant,
  decideEdit,
  rejectLyric,
  releaseBookmark,
  removeCouncilMember,
  sealLyric,
  setApplicantOpinion,
  undoRejectLyric,
  unsealLyric,
} from "@/lib/council-api"
import type { MemberInput } from "@/lib/council-roster"
import type {
  ApplicantView,
  BookmarkItemType,
  BookmarkView,
  CouncilEvent,
  CouncilPerson,
  EditItem,
  EditsPayload,
  OpinionStance,
  QueueItem,
} from "@/lib/council-types"
import { pushToast } from "@/lib/toast"
import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query"
import { councilKeys } from "./useCouncilData"
import { lyricsKeys } from "./useLyricsData"

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
    onMutate: async (target) => {
      await client.cancelQueries({ queryKey: target.itemType === "seal" ? councilKeys.queue : councilKeys.edits })
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

const DECISION_TOAST = "council-decision"

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

export function useUndoDecision() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (event: CouncilEvent) => {
      if (!event.lyric) throw new Error(AUTHED_FETCH_ERRORS.REQUEST_FAILED)
      return event.kind === "seal" ? unsealLyric(event.lyric.id) : undoRejectLyric(event.lyric.id)
    },
    onSuccess: (_, event) => {
      const verb = event.kind === "seal" ? DONE.seal.undo : DONE.reject.undo
      pushToast({ kind: "info", group: DECISION_TOAST, message: `${verb} “${event.lyric?.song}”` })
    },
    onError: (error) => councilErrorToast(error, "undo the decision"),
    onSettled: (_, __, event) =>
      refreshCouncil(client, event.lyric ? { lyricsId: event.lyric.id, videoId: event.lyric.videoId } : undefined),
  })
}

function isQueueDecision(decision: Decision): decision is Extract<Decision, { item: QueueItem }> {
  return decision.kind === "seal" || decision.kind === "reject"
}

function refreshCouncil(client: QueryClient, lyric?: { lyricsId: number; videoId: string }): void {
  client.invalidateQueries({ queryKey: councilKeys.all })
  if (!lyric) return
  client.invalidateQueries({ queryKey: lyricsKeys.variants(lyric.videoId) })
  client.invalidateQueries({ queryKey: lyricsKeys.variant(lyric.lyricsId) })
  client.invalidateQueries({ queryKey: lyricsKeys.revisions(lyric.lyricsId) })
}

function lyricOf(decision: Decision): { lyricsId: number; videoId: string } {
  const lyricsId = isQueueDecision(decision) ? decision.item.id : decision.item.lyricsId
  return { lyricsId, videoId: decision.item.videoId }
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
        group: DECISION_TOAST,
        message: `${done.message} “${decision.item.song}”`,
        action: undo
          ? {
              label: "Undo",
              onAction: () => {
                undo().then(
                  () => {
                    pushToast({ kind: "info", group: DECISION_TOAST, message: `${done.undo} “${decision.item.song}”` })
                    refreshCouncil(client, lyricOf(decision))
                  },
                  (error) => councilErrorToast(error, "undo the decision"),
                )
              },
            }
          : undefined,
      })
    },
    onSettled: (_, __, decision) => refreshCouncil(client, lyricOf(decision)),
  })
}

export function withOpinion(applicant: ApplicantView, me: CouncilPerson, stance: OpinionStance | null): ApplicantView {
  const others = (people: CouncilPerson[]) => people.filter((p) => p.keyId !== me.keyId)
  const support = others(applicant.opinions.support)
  const object = others(applicant.opinions.object)
  if (stance === "support") support.push(me)
  if (stance === "object") object.push(me)
  return { ...applicant, opinions: { ...applicant.opinions, support, object, mine: stance } }
}

const APPLICANTS_PREFIX = ["council", "applicants"] as const

export function useApplicantOpinion(me: CouncilPerson) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ applicant, stance }: { applicant: ApplicantView; stance: OpinionStance | null }) =>
      setApplicantOpinion(applicant.applicantId, stance),
    onMutate: async ({ applicant, stance }) => {
      await client.cancelQueries({ queryKey: APPLICANTS_PREFIX })
      const snapshot = client.getQueriesData<ApplicantView[]>({ queryKey: APPLICANTS_PREFIX })
      client.setQueriesData<ApplicantView[]>({ queryKey: APPLICANTS_PREFIX }, (list) =>
        list?.map((a) => (a.applicantId === applicant.applicantId ? withOpinion(a, me, stance) : a)),
      )
      return { snapshot }
    },
    onError: (error, _, context) => {
      for (const [key, data] of context?.snapshot ?? []) client.setQueryData(key, data)
      councilErrorToast(error, "save your opinion")
    },
    onSettled: () => client.invalidateQueries({ queryKey: APPLICANTS_PREFIX }),
  })
}

export function useApplicantDecision() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ applicant, decision }: { applicant: ApplicantView; decision: "approve" | "reject" }) =>
      decideApplicant(applicant.applicantId, decision),
    onSuccess: (_, { applicant, decision }) => {
      const name = applicant.person?.displayName ?? applicant.displayName
      pushToast({
        kind: "info",
        message: decision === "approve" ? `Added ${name} to the council` : `Turned down ${name}`,
      })
    },
    onError: (error) => councilErrorToast(error, "record the decision"),
    onSettled: () => refreshCouncil(client),
  })
}

export function useAddMember() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (input: MemberInput) => {
      const keyId =
        input.kind === "keyId"
          ? input.value
          : await fetchUserByHandle(input.value).then(
              (user) => user.keyId,
              (error) => {
                throw new Error(
                  isNotFound(error) ? `No account uses the handle ${input.value}` : AUTHED_FETCH_ERRORS.REQUEST_FAILED,
                )
              },
            )
      await addCouncilMember(keyId)
    },
    onSuccess: (_, input) => pushToast({ kind: "info", message: `Added ${input.value} to the council` }),
    onError: (error) => councilErrorToast(error, "add the member"),
    onSettled: () => refreshCouncil(client),
  })
}

export function useRemoveMember() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (member: CouncilPerson) => removeCouncilMember(member.keyId),
    onSuccess: (_, member) => pushToast({ kind: "info", message: `Removed ${member.displayName} from the council` }),
    onError: (error) => councilErrorToast(error, "remove the member"),
    onSettled: () => refreshCouncil(client),
  })
}
