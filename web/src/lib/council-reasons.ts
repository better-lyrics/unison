import type { EditItem, EditThresholds } from "./council-types"
import { ownerWindow } from "./lyric-suggestion"
import type { PendingReason } from "./types"

const pct = (value: number) => `${Math.round(value * 100)}%`

const LABELS: Record<PendingReason, string> = {
  sealed: "Sealed lyric",
  flagged: "Flagged by Jev",
  large_text_drift: "Large text change",
  large_timing_drift: "Large timing change",
  suggested: "Owner did not decide",
}

export function reasonLabel(reason: PendingReason, ownerless = false): string {
  return reason === "suggested" && ownerless ? "No owner" : LABELS[reason]
}

const BECAUSE: Record<Exclude<PendingReason, "suggested">, string> = {
  sealed: "this lyric is sealed",
  flagged: "Jev flagged this file",
  large_text_drift: "the words change a lot",
  large_timing_drift: "the timing changes a lot",
}

export function reasonBecause(reason: Exclude<PendingReason, "suggested">): string {
  return BECAUSE[reason]
}

export function reasonWhy(reason: PendingReason, thresholds: EditThresholds): string {
  switch (reason) {
    case "sealed":
      return "This lyric carries the council seal, so every edit needs a council member to approve it."
    case "flagged":
      return "Jev scored this edit as likely off-song or low-quality."
    case "large_text_drift":
      return `The words changed more than the ${pct(thresholds.textDrift)} threshold.`
    case "large_timing_drift":
      return `Line timings moved more than the ${pct(thresholds.timingDrift)} threshold.`
    case "suggested":
      return `Someone other than the owner suggested this, and the owner did not decide within ${ownerWindow(thresholds.ownerDecisionSec)}.`
  }
}

export function editWhy(edit: EditItem, thresholds: EditThresholds): string {
  if (edit.pendingReason === "suggested" && edit.ownerless) {
    return "This lyric has no owner, so the council decides every suggestion to it."
  }
  const why = reasonWhy(edit.pendingReason, thresholds)
  if (!edit.suggestion || edit.pendingReason === "suggested") return why
  return `${why} Someone other than the owner suggested it.`
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
    case "suggested":
      return edit.ownerless ? "no owner" : "owner silent"
  }
}
