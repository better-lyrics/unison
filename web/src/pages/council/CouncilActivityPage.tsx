import { EmptyState } from "@/components/EmptyState"
import { UserAvatar } from "@/components/UserAvatar"
import { EventSentence } from "@/components/council/EventSentence"
import { fieldClass } from "@/components/council/ListSearch"
import { Segmented } from "@/components/council/Segmented"
import { Switch } from "@/components/council/Switch"
import { TONE_COLOR } from "@/components/council/decision-tone"
import { BlockHead } from "@/components/council/detail-parts"
import { PageHead, cardClass } from "@/components/council/headings"
import { Bone, skeletonKeys } from "@/components/skeleton"
import { buttonClass, tagClass } from "@/components/ui"
import { useCouncilLog, useCouncilMembers, useCouncilOverview } from "@/hooks/useCouncilData"
import { useUndoDecision } from "@/hooks/useCouncilMutations"
import { cn } from "@/lib/cn"
import { canUndo, groupByDay } from "@/lib/council-activity"
import type { CouncilEvent, CouncilSource, EventGroup, RosterMember } from "@/lib/council-types"
import { formatElapsed } from "@/lib/format"
import { IconArrowBackUp, IconHistory } from "@tabler/icons-react"
import { useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useCouncilContext } from "./context"

type KindFilter = "all" | EventGroup

const SOURCE: Record<CouncilSource, { label: string; className: string }> = {
  web: { label: "Web", className: "bg-unison-bg-hover text-unison-text-muted" },
  discord: { label: "Discord", className: "bg-[rgba(88,101,242,0.14)] text-unison-discord" },
  admin: { label: "Admin", className: "bg-unison-bg-hover text-unison-text-muted" },
}

export function CouncilActivityPage() {
  const { meKeyId } = useCouncilContext()
  const now = Math.floor(Date.now() / 1000)
  const [kind, setKind] = useState<KindFilter>("all")
  const [params, setParams] = useSearchParams()
  const actor = params.get("actor") ?? ""
  const setActor = (keyId: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (keyId) next.set("actor", keyId)
        else next.delete("actor")
        return next
      },
      { replace: true },
    )
  const [includeBookmarks, setIncludeBookmarks] = useState(false)
  const members = useCouncilMembers().data
  const log = useCouncilLog({
    kind: kind === "all" ? undefined : kind,
    actor: actor || undefined,
    includeBookmarks: includeBookmarks || undefined,
  })
  const undo = useUndoDecision()
  const events = log.data?.pages.flatMap((page) => page.events)

  return (
    <>
      <PageHead
        title="Activity"
        sub="Every council decision, from the web and from Discord. Undo is available for your own recent decisions."
      />
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <Segmented
          label="Kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: "all", label: "All" },
            { value: "seals", label: "Seals" },
            { value: "rejections", label: "Rejections" },
            { value: "edits", label: "Edits" },
            { value: "membership", label: "Membership" },
          ]}
        />
        <select aria-label="Member" value={actor} onChange={(e) => setActor(e.target.value)} className={fieldClass}>
          <option value="">All members</option>
          {members?.map((m) => (
            <option key={m.keyId} value={m.keyId}>
              {m.displayName}
            </option>
          ))}
        </select>
        <span className="flex-1" />
        <span className="text-xs text-unison-text-muted">
          <Switch checked={includeBookmarks} onChange={setIncludeBookmarks}>
            Include bookmarks
          </Switch>
        </span>
      </div>
      <div className="grid items-start gap-12 min-[1280px]:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          {events === undefined ? (
            <div className="flex flex-col gap-1.5 pt-7">
              {skeletonKeys("log", 6).map((key) => (
                <Bone key={key} className="h-[60px] w-full rounded-lg" />
              ))}
            </div>
          ) : events.length === 0 ? (
            <div className="pt-7">
              <EmptyState
                icon={<IconHistory className="size-5" stroke={1.5} />}
                title="No activity matches"
                hint="Try another filter or member."
              />
            </div>
          ) : (
            <>
              {groupByDay(events, now).map((day) => (
                <section key={day.label} aria-label={day.label}>
                  <h2 className="flex gap-2 pt-7 pb-2.5 text-[11px] uppercase tracking-[0.08em] text-unison-text-muted">
                    {day.label} <span className="font-mono tracking-normal">{day.events.length}</span>
                  </h2>
                  <ul className="flex flex-col gap-1.5">
                    {day.events.map((event) => (
                      <LogItem
                        key={event.id}
                        event={event}
                        now={now}
                        undoable={canUndo(event, meKeyId, now)}
                        undoing={undo.isPending}
                        onUndo={() => undo.mutate(event)}
                      />
                    ))}
                  </ul>
                </section>
              ))}
              {log.hasNextPage ? (
                <div className="mt-4 flex justify-center">
                  <button
                    type="button"
                    className={buttonClass("fill", "sm")}
                    disabled={log.isFetchingNextPage}
                    onClick={() => log.fetchNextPage()}
                  >
                    {log.isFetchingNextPage ? "Loading" : "Load older activity"}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
        <WeekAside members={members} selected={actor} onSelect={(keyId) => setActor(keyId === actor ? "" : keyId)} />
      </div>
    </>
  )
}

function LogItem({
  event,
  now,
  undoable,
  undoing,
  onUndo,
}: {
  event: CouncilEvent
  now: number
  undoable: boolean
  undoing: boolean
  onUndo: () => void
}) {
  const source = SOURCE[event.source]
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-3.5 rounded-lg bg-white/[0.02] px-4 py-3.5 transition-colors hover:bg-unison-bg-hover">
      {event.actor ? (
        <UserAvatar
          avatarUrl={event.actor.avatarUrl}
          keyId={event.actor.keyId}
          className="size-7 rounded-full object-cover outline outline-1 -outline-offset-1 outline-white/10"
          loading="lazy"
        />
      ) : (
        <span aria-hidden className="size-7 rounded-full bg-unison-bg-hover" />
      )}
      <div>
        <div
          className={cn(
            "text-[13px] leading-normal text-unison-text-secondary",
            event.undone && "text-unison-text-muted [&_a]:text-unison-text-secondary [&_b]:text-unison-text-secondary",
          )}
        >
          <EventSentence event={event} links />
          {event.undone ? <span className={cn(tagClass, "ml-2")}>Undone</span> : null}
        </div>
        {event.note ? <div className="mt-1 text-xs leading-normal text-unison-text-muted">{event.note}</div> : null}
      </div>
      <div className="flex items-center gap-2">
        {undoable ? (
          <button type="button" disabled={undoing} className={buttonClass("ghost", "sm")} onClick={onUndo}>
            <IconArrowBackUp aria-hidden className="size-3.5" stroke={1.75} />
            Undo
          </button>
        ) : null}
        <span className={cn("rounded px-[5px] py-px text-[10px] font-semibold tracking-[0.04em]", source.className)}>
          {source.label}
        </span>
        <time
          dateTime={new Date(event.at * 1000).toISOString()}
          className="font-mono text-[11px] text-unison-text-muted"
        >
          {formatElapsed(now - event.at)}
        </time>
      </div>
    </li>
  )
}

const WEEK_SERIES = [
  { key: "sealed", label: "Sealed", color: TONE_COLOR.seal },
  { key: "rejected", label: "Rejected", color: TONE_COLOR.reject },
  { key: "edits", label: "Edits", color: TONE_COLOR.edit },
] as const

function WeekAside({
  members,
  selected,
  onSelect,
}: {
  members: RosterMember[] | undefined
  selected: string
  onSelect: (keyId: string) => void
}) {
  const split = useCouncilOverview().data?.sourceSplit
  if (!members) return null
  const rows = members
    .map((m) => ({ member: m, total: m.lastWeek.sealed + m.lastWeek.rejected + m.lastWeek.edits }))
    .sort((a, b) => b.total - a.total)
  const max = Math.max(1, ...rows.map((r) => r.total))
  const decided = split ? split.web + split.discord : 0
  const share = (n: number) => `${Math.round((n / decided) * 100)}%`

  return (
    <aside
      className={cn(
        cardClass,
        "p-5 min-[1280px]:sticky min-[1280px]:top-[calc(var(--app-header-h)+2rem)] min-[1280px]:mt-7",
      )}
    >
      <BlockHead title="Last 7 days" aside="Decisions per member" />
      <ul className="mt-1 mb-2 flex flex-wrap gap-3.5 text-xs text-unison-text-secondary">
        {WEEK_SERIES.map((s) => (
          <li key={s.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-[2px]" style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
      <ul aria-label="Decisions per member" className="flex flex-col gap-0.5">
        {rows.map(({ member, total }) => (
          <li key={member.keyId}>
            <button
              type="button"
              aria-pressed={selected === member.keyId}
              onClick={() => onSelect(member.keyId)}
              className="-mx-2 grid w-[calc(100%+1rem)] cursor-pointer grid-cols-[20px_104px_minmax(0,1fr)_24px] items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] text-unison-text-secondary transition-colors hover:bg-unison-bg-hover hover:text-unison-text aria-pressed:bg-unison-bg-hover aria-pressed:text-unison-text"
            >
              <UserAvatar
                avatarUrl={member.avatarUrl}
                keyId={member.keyId}
                className="size-5 rounded-full object-cover"
                loading="lazy"
              />
              <span className="truncate">{member.displayName}</span>
              <span className="flex h-2 min-w-0.5 gap-0.5" style={{ width: `${(total / max) * 100}%` }}>
                {WEEK_SERIES.map((s) =>
                  member.lastWeek[s.key] > 0 ? (
                    <i
                      key={s.key}
                      className="block rounded-[2px]"
                      style={{ flex: member.lastWeek[s.key], background: s.color }}
                    />
                  ) : null,
                )}
              </span>
              <b className="text-right font-mono text-xs font-medium text-unison-text">{total}</b>
            </button>
          </li>
        ))}
      </ul>
      {split && decided > 0 ? (
        <div className="mt-6 grid grid-cols-2 gap-3">
          <div>
            <b className="block font-mono text-lg font-semibold">{share(split.web)}</b>
            <span className="mt-0.5 block text-[11px] leading-[1.4] text-unison-text-muted">
              of decisions made on the web
            </span>
          </div>
          <div>
            <b className="block font-mono text-lg font-semibold">{share(split.discord)}</b>
            <span className="mt-0.5 block text-[11px] leading-[1.4] text-unison-text-muted">
              made from Discord cards
            </span>
          </div>
        </div>
      ) : null}
    </aside>
  )
}
