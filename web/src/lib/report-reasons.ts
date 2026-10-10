export type ReportReason = "wrong_song" | "bad_sync" | "offensive" | "spam" | "other"

export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  wrong_song: "Wrong song",
  bad_sync: "Bad sync",
  offensive: "Offensive",
  spam: "Spam",
  other: "Other",
}
