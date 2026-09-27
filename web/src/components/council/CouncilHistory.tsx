import { useLyricCouncilHistory } from "@/hooks/useCouncilData"
import { cn } from "@/lib/cn"
import type { CouncilEventKind } from "@/lib/council-types"
import { formatElapsed } from "@/lib/format"

const PHRASES: Partial<Record<CouncilEventKind, { text: string; dot?: string }>> = {
  seal: { text: "sealed it", dot: "before:bg-unison-medal-gold" },
  unseal: { text: "lifted the seal" },
  reject: { text: "rejected it", dot: "before:bg-council-reject" },
  unreject: { text: "undid the rejection" },
  edit_approve: { text: "approved an edit", dot: "before:bg-council-edit" },
  edit_reject: { text: "rejected an edit", dot: "before:bg-council-reject" },
}

export function CouncilHistory({ lyricId, now }: { lyricId: number; now: number }) {
  const events = useLyricCouncilHistory(lyricId).data?.events.filter((e) => PHRASES[e.kind])
  if (!events) return null
  if (events.length === 0) return <p className="text-[13px] text-unison-text-muted">No earlier council decisions.</p>
  return (
    <ul className="pl-1">
      {events.map((event) => {
        const phrase = PHRASES[event.kind]
        return (
          <li
            key={event.id}
            className={cn(
              "relative pb-3.5 pl-5 text-[13px] leading-normal text-unison-text-secondary before:absolute before:top-[7px] before:left-[3px] before:size-[7px] before:rounded-full before:bg-unison-text-muted before:content-['']",
              phrase?.dot,
            )}
          >
            <b className="font-medium text-unison-text">{event.actor?.displayName ?? "An admin"}</b> {phrase?.text}
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
