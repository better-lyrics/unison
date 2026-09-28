import { EVENT_WORDS } from "@/lib/council-activity"
import type { CouncilEvent } from "@/lib/council-types"
import { Link } from "react-router-dom"
import { TONE_TEXT } from "./decision-tone"

export function eventSubject(event: CouncilEvent): string {
  return event.lyric?.song ?? event.subject?.displayName ?? "a deleted item"
}

export function EventSentence({ event, links = false }: { event: CouncilEvent; links?: boolean }) {
  const { verb, after, tone } = EVENT_WORDS[event.kind]
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
      <b>{event.actor?.displayName ?? "An admin"}</b> <span className={tone ? TONE_TEXT[tone] : undefined}>{verb}</span>{" "}
      {subject}
      {after ? ` ${after}` : null}
    </span>
  )
}
