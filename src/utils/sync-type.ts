export type SyncKind = "syllable" | "word" | "line" | "unsynced"

export const SYNC_KINDS: Record<SyncKind, { label: string; color: string | null; tint: string }> = {
	syllable: { label: "Richsync", color: "#fcd34d", tint: "rgba(252, 211, 77, 0.16)" },
	word: { label: "Word", color: "#93c5fd", tint: "rgba(96, 165, 250, 0.16)" },
	line: { label: "Line", color: "#86efac", tint: "rgba(74, 222, 128, 0.16)" },
	unsynced: { label: "Unsynced", color: null, tint: "rgba(255, 255, 255, 0.08)" },
}

export function syncTypeFor(sync: string, format: string | null | undefined): SyncKind {
	if (sync === "plain") return "unsynced"
	if (sync === "linesync") return "line"
	return format?.toLowerCase() === "ttml" ? "syllable" : "word"
}
