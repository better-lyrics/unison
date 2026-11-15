import { AUTHED_FETCH_ERRORS, AuthedFetchError } from "./authedFetch"
import { COMMUNITY_KEY_ID } from "./community"
import { plural } from "./format"
import type { DiffRow } from "./revision-types"
import type { LyricsFormat, PendingReason, RevisionSuggestion, VariantPendingRevision } from "./types"

export const REJECT_NOTE_MAX = 1000

export const ownerWindow = (ownerDecisionSec: number): string => plural(ownerDecisionSec / 86_400, "day", "days")

export type SuggestionDecider = "owner" | "council"

export const isOwnerless = (submitterKeyId: string | null | undefined): boolean =>
  !submitterKeyId || submitterKeyId === COMMUNITY_KEY_ID

export function suggestionDecider(suggestion: {
  pendingReason: PendingReason | null
  sealed?: boolean
  ownerless?: boolean
}): SuggestionDecider {
  const plain = suggestion.pendingReason === null || suggestion.pendingReason === "suggested"
  return plain && !suggestion.sealed && !suggestion.ownerless ? "owner" : "council"
}

export type SuggestAction = "suggest" | "withdraw" | "waiting" | "sign-in" | "needs-lyric" | "none"

interface Viewer {
  keyId: string
  canSuggest?: boolean
}

interface SuggestableLyric {
  submitterKeyId: string | null
  suggestion?: RevisionSuggestion
  pending?: VariantPendingRevision | null
}

export function suggestAction(viewer: Viewer | null, lyric: SuggestableLyric): SuggestAction {
  if (!viewer) return "sign-in"
  if (viewer.keyId === lyric.submitterKeyId) return "none"
  if (lyric.suggestion?.authorKeyId === viewer.keyId) return "withdraw"
  if (viewer.canSuggest === false) return "needs-lyric"
  return lyric.suggestion || lyric.pending ? "waiting" : "suggest"
}

export type ApproveState = "available" | "council-decides" | "loading" | "not-loaded" | "hidden"

export type SuggestionContent = "loading" | "failed" | "loaded"

export const contentOf = (query: { isError: boolean; data: unknown }): SuggestionContent =>
  query.isError ? "failed" : query.data === undefined ? "loading" : "loaded"

export interface PreviewActions {
  approve: ApproveState
  reject: boolean
  withdraw: boolean
}

interface PreviewViewer {
  keyId: string
  council: boolean
}

interface PreviewedLyric {
  submitterKeyId: string | null
  suggestion: RevisionSuggestion
  content: SuggestionContent
}

export const isOwnSuggestion = (viewer: { keyId: string } | null, authorKeyId: string | null | undefined): boolean =>
  viewer !== null && viewer.keyId === authorKeyId

const NO_ACTIONS: PreviewActions = { approve: "hidden", reject: false, withdraw: false }

export function previewActions(viewer: PreviewViewer | null, lyric: PreviewedLyric): PreviewActions {
  const actions = viewerActions(viewer, lyric)
  const decides = actions.reject || actions.approve !== "hidden"
  if (!decides || lyric.content === "loaded") return actions
  return { approve: lyric.content === "failed" ? "not-loaded" : "loading", reject: false, withdraw: false }
}

function viewerActions(viewer: PreviewViewer | null, lyric: PreviewedLyric): PreviewActions {
  if (!viewer) return NO_ACTIONS
  const { suggestion } = lyric
  if (isOwnSuggestion(viewer, suggestion.authorKeyId)) return { ...NO_ACTIONS, withdraw: true }
  const councilMay = viewer.council && suggestion.councilDecidesAt === null
  if (viewer.keyId === lyric.submitterKeyId) {
    const ownerMay = suggestionDecider(suggestion) === "owner"
    return { approve: ownerMay || councilMay ? "available" : "council-decides", reject: true, withdraw: false }
  }
  return councilMay ? { approve: "available", reject: true, withdraw: false } : NO_ACTIONS
}

export const JUMP_LEAD_IN_MS = 2000

export type JumpChange = "text" | "added" | "removed" | "timing" | "syllables"

export interface JumpTarget {
  lineNo: number
  startMs: number
  seekSeconds: number
  change: JumpChange
  deltaMs?: number
  text: string
}

function jumpOf(row: DiffRow): Omit<JumpTarget, "seekSeconds"> | null {
  if (row.kind === "gap" || row.kind === "same" || row.kind === "field" || row.startMs === null) return null
  const at = { lineNo: row.lineNo, startMs: row.startMs }
  switch (row.kind) {
    case "word":
      if (row.head) return null
      return {
        ...at,
        change: "text",
        text: row.parts
          .filter(([op]) => op !== "-")
          .map(([, part]) => part)
          .join(""),
      }
    case "add":
    case "del":
      if (row.head) return null
      return { ...at, change: row.kind === "add" ? "added" : "removed", text: row.text }
    case "timing":
      return { ...at, change: "timing", deltaMs: row.deltaMs, text: row.text }
    case "syllable":
      return { ...at, change: "syllables", text: row.text }
  }
}

export function jumpTargets(rows: DiffRow[]): JumpTarget[] {
  return rows
    .flatMap((row) => {
      const jump = jumpOf(row)
      return jump ? [{ ...jump, seekSeconds: Math.max(0, jump.startMs - JUMP_LEAD_IN_MS) / 1000 }] : []
    })
    .sort((a, b) => a.startMs - b.startMs)
}

const TTML_ROOT = /<tt[\s>]/i
const LRC_WORD_TAG = /<\d{1,2}:\d{2}[.:]\d{2,3}>/
const LRC_LINE_TAG = /\[\d{1,2}:\d{2}[.:]\d{2,3}\]/

export function lyricsFormatOf(text: string): LyricsFormat {
  if (TTML_ROOT.test(text)) return "ttml"
  return LRC_WORD_TAG.test(text) || LRC_LINE_TAG.test(text) ? "lrc" : "plain"
}

export function suggestionErrorMessage(error: unknown): string {
  if (!(error instanceof AuthedFetchError)) return "Something went wrong. Try again."
  if (error.status === 401) return "Sign in again to continue."
  if (error.hint) return error.hint
  if (error.status === 429) return "Too many tries. Wait a minute and try again."
  const known = !Object.values(AUTHED_FETCH_ERRORS).some((code) => code === error.message)
  return known ? error.message : "Something went wrong. Try again."
}
