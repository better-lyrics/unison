import type { DecisionTone } from "@/lib/council-activity"

export const TONE_COLOR: Record<DecisionTone, string> = {
  seal: "var(--color-council-seal)",
  reject: "var(--color-council-reject)",
  edit: "var(--color-council-edit)",
}

export const TONE_TEXT: Record<DecisionTone, string> = {
  seal: "text-unison-medal-gold",
  reject: "text-council-reject-ink",
  edit: "text-council-edit-ink",
}

export const TONE_DOT: Record<DecisionTone, string> = {
  seal: "before:bg-unison-medal-gold",
  reject: "before:bg-council-reject",
  edit: "before:bg-council-edit",
}
