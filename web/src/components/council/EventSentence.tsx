import type { CouncilEvent, CouncilEventKind } from "@/lib/council-types"
import { Link } from "react-router-dom"

const VERBS: Record<CouncilEventKind, { verb: string; after?: string; tone?: string }> = {
  seal: { verb: "sealed", tone: "text-unison-medal-gold" },
  unseal: { verb: "lifted the seal on" },
  reject: { verb: "rejected", tone: "text-council-reject-ink" },
  unreject: { verb: "undid the rejection of" },
  edit_approve: { verb: "approved an edit to", tone: "text-council-edit-ink" },
  edit_reject: { verb: "rejected an edit to", tone: "text-council-reject-ink" },
  bookmark: { verb: "bookmarked" },
  release: { verb: "released" },
  member_add: { verb: "added", after: "to the council" },
  member_remove: { verb: "removed", after: "from the council" },
  applicant_approve: { verb: "approved applicant" },
  applicant_reject: { verb: "turned down applicant" },
}

export function eventSubject(event: CouncilEvent): string {
  return event.lyric?.song ?? event.subject?.displayName ?? "a deleted item"
}

export function EventSentence({ event, links = false }: { event: CouncilEvent; links?: boolean }) {
  const { verb, after, tone } = VERBS[event.kind]
  const subject =
    links && event.lyric ? (
      <>
        <Link
          to={`/song/${encodeURIComponent(event.lyric.videoId)}`}
          className="font-medium text-unison-text decoration-unison-border-strong underline-offset-[3px] hover:underline"
        >
          {event.lyric.song}
        </Link>
        <span className="text-unison-text-muted"> by {event.lyric.artist}</span>
      </>
    ) : (
      <b>{eventSubject(event)}</b>
    )
  return (
    <span className="[&_b]:font-medium [&_b]:text-unison-text">
      <b>{event.actor?.displayName ?? "An admin"}</b> <span className={tone}>{verb}</span> {subject}
      {after ? ` ${after}` : null}
    </span>
  )
}
