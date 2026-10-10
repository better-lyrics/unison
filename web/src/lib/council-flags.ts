import type { CouncilFlag, FlagReason, FlagReport } from "./council-types"
import { REPORT_REASON_LABEL } from "./report-reasons"

const REASON_ORDER: FlagReason[] = ["spam", "wrong_song", "offensive"]

export interface ReportGroup {
  reason: FlagReason
  label: string
  reports: FlagReport[]
}

export function reportGroups(reports: FlagReport[]): ReportGroup[] {
  return REASON_ORDER.map((reason) => ({
    reason,
    label: REPORT_REASON_LABEL[reason],
    reports: reports.filter((r) => r.reason === reason),
  })).filter((group) => group.reports.length > 0)
}

export function flagConflict(flag: CouncilFlag, meKeyId: string): string | null {
  if (flag.submitter?.keyId === meKeyId) return "You submitted this lyric"
  if (flag.reports.some((r) => r.reporter?.keyId === meKeyId)) return "You reported this lyric"
  return null
}
