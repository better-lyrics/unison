import type { LyricsFormat, SyncType } from "./types"

export type SyncKind = "syllable" | "word" | "line" | "unsynced"

export const SYNC_KINDS: Record<SyncKind, { label: string; color: string; tint: string }> = {
  syllable: { label: "Syllable", color: "#fcd34d", tint: "rgba(252, 211, 77, 0.16)" },
  word: { label: "Word", color: "#93c5fd", tint: "rgba(96, 165, 250, 0.16)" },
  line: { label: "Line", color: "#86efac", tint: "rgba(74, 222, 128, 0.16)" },
  unsynced: {
    label: "Unsynced",
    color: "var(--ink-3, var(--color-unison-text-muted))",
    tint: "rgba(255, 255, 255, 0.08)",
  },
}

export function syncTypeFor(sync: SyncType, format: LyricsFormat | string | null | undefined): SyncKind {
  if (sync === "plain") return "unsynced"
  if (sync === "linesync") return "line"
  return format?.toLowerCase() === "ttml" ? "syllable" : "word"
}
