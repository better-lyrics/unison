import { titleCase } from "./format"

export const REPORT_REASONS = ["wrong_song", "bad_sync", "offensive", "spam", "other"] as const

export type ReportReason = (typeof REPORT_REASONS)[number]

export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  wrong_song: "Wrong song",
  bad_sync: "Bad sync",
  offensive: "Offensive",
  spam: "Spam",
  other: "Other",
}

export function isReportReason(value: string): value is ReportReason {
  return REPORT_REASONS.some((reason) => reason === value)
}

export function reportReasonLabel(reason: string): string {
  return isReportReason(reason) ? REPORT_REASON_LABEL[reason] : titleCase(reason.replaceAll("_", " "))
}
