import { groupByBookmark } from "./council-triage"
import type { ApplicantView, EditItem, QueueItem } from "./council-types"
import { formatElapsed, formatRemaining, plural } from "./format"

export type NeedKind = "sealed-edit" | "flagged-edit" | "my-bookmarks" | "expiring-bookmark" | "applicants"

export interface Need {
  kind: NeedKind
  tone: "gold" | "warn" | "plain"
  title: string
  sub: string
  to: string
}

export interface NeedsInput {
  queue: QueueItem[]
  edits: EditItem[]
  applicants: ApplicantView[]
  meKeyId: string
  now: number
}

const EXPIRING_SOON_SEC = 12 * 3600

function oldest<T>(items: T[], at: (item: T) => number): T | undefined {
  return items.reduce<T | undefined>(
    (best, item) => (best === undefined || at(item) < at(best) ? item : best),
    undefined,
  )
}

export function deriveNeeds({ queue, edits, applicants, meKeyId, now }: NeedsInput): Need[] {
  const needs: Need[] = []
  const waiting = (at: number) => `waiting ${formatElapsed(now - at)}`

  const sealed = oldest(
    edits.filter((e) => e.pendingReason === "sealed"),
    (e) => e.createdAt,
  )
  if (sealed) {
    needs.push({
      kind: "sealed-edit",
      tone: "gold",
      title: `Edit to sealed lyric “${sealed.song}”`,
      sub: `Rev ${sealed.revNo} would replace the live sealed Rev ${sealed.liveRevNo} · ${waiting(sealed.createdAt)}`,
      to: `/council/edits?item=${sealed.revisionId}`,
    })
  }

  const flagged = oldest(
    edits.filter((e) => e.pendingReason === "flagged"),
    (e) => e.createdAt,
  )
  if (flagged) {
    const score = flagged.jevProbability === null ? "" : ` at ${Math.round(flagged.jevProbability * 100)}%`
    needs.push({
      kind: "flagged-edit",
      tone: "warn",
      title: `“${flagged.song}” edit flagged by Jev${score}`,
      sub: `By ${flagged.author?.displayName ?? "an unknown author"} · ${waiting(flagged.createdAt)}`,
      to: `/council/edits?item=${flagged.revisionId}`,
    })
  }

  const { mine } = groupByBookmark<QueueItem | EditItem>([...queue, ...edits], meKeyId, now)
  const firstToGo = oldest(mine, (i) => i.bookmark?.expiresAt ?? 0)
  if (firstToGo?.bookmark) {
    needs.push({
      kind: "my-bookmarks",
      tone: "plain",
      title: `You have ${plural(mine.length, "bookmarked item", "bookmarked items")}`,
      sub: `“${firstToGo.song}” goes back to the open queue in ${formatRemaining(firstToGo.bookmark.expiresAt - now)}`,
      to: "/council/bookmarks",
    })
  }

  const expiring = oldest(
    groupByBookmark(queue, meKeyId, now).others.filter((i) => (i.bookmark?.expiresAt ?? 0) - now < EXPIRING_SOON_SEC),
    (i) => i.bookmark?.expiresAt ?? 0,
  )
  if (expiring?.bookmark) {
    needs.push({
      kind: "expiring-bookmark",
      tone: "plain",
      title: `${expiring.bookmark.holder.displayName}'s bookmark on “${expiring.song}” expires soon`,
      sub: `${formatRemaining(expiring.bookmark.expiresAt - now)} left · it returns to the open queue after that`,
      to: `/council/queue?item=${expiring.id}`,
    })
  }

  const undecided = applicants.filter((a) => a.state === "pending_review" && a.opinions.mine === null).length
  if (undecided > 0) {
    needs.push({
      kind: "applicants",
      tone: "plain",
      title: `${plural(undecided, "applicant needs", "applicants need")} your opinion`,
      sub: "Admins decide. Your support or objection is shown on each card.",
      to: "/council/applicants",
    })
  }

  return needs
}
