import type { LyricsFormat, PendingReason, RevisionSuggestion } from "./types"

export type DiffPart = ["=" | "+" | "-", string]

export interface HeadTextRef {
  kind: "translation" | "transliteration" | "credit"
  lang: string | null
  line: number | null
}

export interface SyllableChange {
  before: string | null
  after: string | null
  moved: number
}

export type DiffRow =
  | { kind: "same"; lineNo: number; startMs: number | null; text: string; head?: HeadTextRef }
  | { kind: "add"; lineNo: number; startMs: number | null; text: string; head?: HeadTextRef }
  | { kind: "del"; lineNo: number; startMs: number | null; text: string; head?: HeadTextRef }
  | { kind: "word"; lineNo: number; startMs: number | null; parts: DiffPart[]; head?: HeadTextRef }
  | {
      kind: "timing"
      lineNo: number
      startMs: number
      deltaMs: number
      text: string
      syllables?: SyllableChange
    }
  | ({ kind: "syllable"; lineNo: number; startMs: number | null; text: string } & SyllableChange)
  | { kind: "gap"; count: number; section?: "head" }
  | { kind: "field"; field: "language" | "isrc" | "album"; before: string | null; after: string | null }

export interface RevisionDiff {
  rows: DiffRow[]
  againstRevNo: number | null
}

export type RevisionStatus = "live" | "past" | "pending" | "superseded" | "rejected" | "withdrawn"

export interface RevisionSummary {
  id: number
  revNo: number
  status: RevisionStatus
  pendingReason: PendingReason | null
  isAnchor: boolean
  textDrift: number
  timingDrift: number
  revertsRevNo: number | null
  author: { displayName: string } | null
  reviewNote: string | null
  createdAt: number
  reviewedAt: number | null
}

export interface RevisionDetail extends RevisionSummary {
  lyrics: string
  format: LyricsFormat
}

export interface RevisionInput {
  lyrics: string
  format: LyricsFormat
}

export interface FieldCheck {
  field: "lyrics" | "language" | "isrc" | "album"
  status: "ok" | "warn" | "bad"
  message: string
  line?: number
  language?: string
  detectedLanguage?: string
}

export interface RevisionRateLimit {
  lyricRemaining: number
  lyricLimit: number
  userRemaining: number
  userLimit: number
}

export interface PreviewResult {
  checks: FieldCheck[]
  outcome: { goesLive: boolean; reason: PendingReason | null }
  noChanges: boolean
  rateLimit: RevisionRateLimit
  diff: RevisionDiff
  noteMaxLength: number
  ownerDecisionSec: number
}

export interface SuggestionInboxItem {
  lyricsId: number
  videoId: string
  song: string
  artist: string
  suggestion: RevisionSuggestion
}
