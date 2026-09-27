import type { EditItem, EditThresholds, PendingReason } from "./council-types"

const pct = (value: number) => `${Math.round(value * 100)}%`

const LABELS: Record<PendingReason, string> = {
  sealed: "Sealed lyric",
  flagged: "Flagged by Jev",
  large_text_drift: "Large text change",
  large_timing_drift: "Large timing change",
}

export function reasonLabel(reason: PendingReason): string {
  return LABELS[reason]
}

export function reasonWhy(reason: PendingReason, thresholds: EditThresholds): string {
  switch (reason) {
    case "sealed":
      return "This lyric carries the council seal, so every owner edit needs a council member to approve it."
    case "flagged":
      return "Jev scored this edit as likely off-song or low-quality."
    case "large_text_drift":
      return `The words changed more than the ${pct(thresholds.textDrift)} threshold.`
    case "large_timing_drift":
      return `Line timings moved more than the ${pct(thresholds.timingDrift)} threshold.`
  }
}

export function reasonMetric(edit: EditItem): string {
  switch (edit.pendingReason) {
    case "sealed":
      return "sealed"
    case "flagged":
      return edit.jevProbability === null ? "Jev" : `Jev ${pct(edit.jevProbability)}`
    case "large_text_drift":
      return `${pct(edit.textDrift)} text`
    case "large_timing_drift":
      return `${pct(edit.timingDrift)} timing`
  }
}
