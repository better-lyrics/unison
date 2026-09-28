import { useLyricCouncilHistory } from "@/hooks/useCouncilData"
import { cn } from "@/lib/cn"
import { EVENT_WORDS } from "@/lib/council-activity"
import { formatElapsed } from "@/lib/format"
import { TONE_DOT } from "./decision-tone"
import { historyItemClass } from "./detail-parts"

export function CouncilHistory({ lyricId, now }: { lyricId: number; now: number }) {
  const events = useLyricCouncilHistory(lyricId).data?.events.filter((e) => EVENT_WORDS[e.kind].onOwnLyric)
  if (!events) return null
  if (events.length === 0) return <p className="text-[13px] text-unison-text-muted">No earlier council decisions.</p>
  return (
    <ul className="pl-1">
      {events.map((event) => {
        const { onOwnLyric, tone } = EVENT_WORDS[event.kind]
        return (
          <li key={event.id} className={cn(historyItemClass, tone && TONE_DOT[tone])}>
            <b className="font-medium text-unison-text">{event.actor?.displayName ?? "An admin"}</b> {onOwnLyric}
            <time className="ml-1.5 font-mono text-[11px] text-unison-text-muted">{formatElapsed(now - event.at)}</time>
            {event.note ? (
              <q className="mt-0.5 block text-xs text-unison-text-muted [quotes:'\201C'_'\201D']">{event.note}</q>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
