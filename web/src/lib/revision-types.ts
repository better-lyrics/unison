import type { PendingReason } from "./council-types"

export type DiffPart = ["=" | "+" | "-", string]

export interface HeadTextRef {
  kind: "translation" | "transliteration" | "credit"
  lang: string | null
  line: number | null
}

export type DiffRow =
  | { kind: "same"; lineNo: number; startMs: number | null; text: string; head?: HeadTextRef }
  | { kind: "add"; lineNo: number; startMs: number | null; text: string; head?: HeadTextRef }
  | { kind: "del"; lineNo: number; startMs: number | null; text: string; head?: HeadTextRef }
  | { kind: "word"; lineNo: number; startMs: number | null; parts: DiffPart[]; head?: HeadTextRef }
  | { kind: "timing"; lineNo: number; startMs: number; deltaMs: number; text: string }
  | { kind: "gap"; count: number; section?: "head" }

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
