import type { CouncilEvent, CouncilEventKind } from "./council-types"

export type DecisionTone = "seal" | "reject" | "edit"

export interface EventWords {
  verb: string
  after?: string
  onOwnLyric?: string
  tone?: DecisionTone
}

export const EVENT_WORDS: Record<CouncilEventKind, EventWords> = {
  seal: { verb: "sealed", onOwnLyric: "sealed it", tone: "seal" },
  unseal: { verb: "lifted the seal on", onOwnLyric: "lifted the seal" },
  reject: { verb: "rejected", onOwnLyric: "rejected it", tone: "reject" },
  unreject: { verb: "undid the rejection of", onOwnLyric: "undid the rejection" },
  edit_approve: { verb: "approved an edit to", onOwnLyric: "approved an edit", tone: "edit" },
  edit_reject: { verb: "rejected an edit to", onOwnLyric: "rejected an edit", tone: "reject" },
  metadata_propose: { verb: "proposed new details for" },
  metadata_approve: { verb: "approved new details for" },
  metadata_reject: { verb: "rejected new details for" },
  bookmark: { verb: "bookmarked" },
  release: { verb: "released" },
  member_add: { verb: "added", after: "to the council" },
  member_remove: { verb: "removed", after: "from the council" },
  applicant_approve: { verb: "approved applicant" },
  applicant_reject: { verb: "turned down applicant" },
}

const DAY_MS = 86_400_000
const UNDO_WINDOW_SEC = 3 * 86400

const fullDate = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" })

function dayStart(epochSec: number): number {
  const d = new Date(epochSec * 1000)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function groupByDay(events: CouncilEvent[], now: number): { label: string; events: CouncilEvent[] }[] {
  const today = dayStart(now)
  const groups: { label: string; events: CouncilEvent[] }[] = []
  for (const event of events) {
    const start = dayStart(event.at)
    const label = start === today ? "Today" : start === today - DAY_MS ? "Yesterday" : fullDate.format(event.at * 1000)
    const last = groups.at(-1)
    if (last?.label === label) last.events.push(event)
    else groups.push({ label, events: [event] })
  }
  return groups
}

export function canUndo(event: CouncilEvent, meKeyId: string, now: number): boolean {
  return (
    (event.kind === "seal" || event.kind === "reject") &&
    event.actor?.keyId === meKeyId &&
    !event.undone &&
    event.lyric !== null &&
    now - event.at <= UNDO_WINDOW_SEC
  )
}
