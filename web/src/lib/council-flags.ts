import type { CouncilFlag } from "./council-types"
import { REPORT_REASONS, isReportReason, reportReasonLabel } from "./report-reasons"

export interface ReportGroup<R> {
  reason: string
  label: string
  reports: R[]
}

const rank = (reason: string) => (isReportReason(reason) ? REPORT_REASONS.indexOf(reason) : REPORT_REASONS.length)

export function reportGroups<R extends { reason: string }>(reports: R[]): ReportGroup<R>[] {
  const reasons = [...new Set(reports.map((r) => r.reason))].sort((a, b) => rank(a) - rank(b))
  return reasons.map((reason) => ({
    reason,
    label: reportReasonLabel(reason),
    reports: reports.filter((r) => r.reason === reason),
  }))
}

const CONFLICT_REASON = {
  submitter: "You submitted this lyric",
  reporter: "You reported this lyric",
} as const

export function flagConflict(flag: Pick<CouncilFlag, "conflict">): string | null {
  return flag.conflict ? CONFLICT_REASON[flag.conflict] : null
}
