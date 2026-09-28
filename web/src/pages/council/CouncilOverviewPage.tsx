import { EmptyState } from "@/components/EmptyState"
import { Kbd } from "@/components/Kbd"
import { StatPill } from "@/components/StatPills"
import { UserAvatar } from "@/components/UserAvatar"
import { Histogram } from "@/components/charts/Histogram"
import { StackedBars } from "@/components/charts/StackedBars"
import { EventSentence } from "@/components/council/EventSentence"
import { NeedsList } from "@/components/council/NeedsList"
import { Segmented } from "@/components/council/Segmented"
import { StatTile } from "@/components/council/StatTile"
import { TONE_COLOR } from "@/components/council/decision-tone"
import { PageHead, SectionHead, cardClass } from "@/components/council/headings"
import { Bone, skeletonKeys } from "@/components/skeleton"
import { buttonClass } from "@/components/ui"
import {
  useCouncilApplicants,
  useCouncilEdits,
  useCouncilFeed,
  useCouncilOverview,
  useCouncilQueue,
} from "@/hooks/useCouncilData"
import { cn } from "@/lib/cn"
import { deriveNeeds } from "@/lib/council-needs"
import { openItems } from "@/lib/council-triage"
import type { DayDecisions } from "@/lib/council-types"
import { waitBuckets } from "@/lib/council-wait"
import { formatElapsed } from "@/lib/format"
import { IconArrowRight, IconCheck, IconClock, IconPencil, IconRosetteDiscountCheck, IconX } from "@tabler/icons-react"
import { type ReactNode, useState } from "react"
import { Link } from "react-router-dom"
import { useCouncilContext } from "./context"

const WEEK = 7 * 86400
const headDate = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" })
const monthName = new Intl.DateTimeFormat("en-GB", { month: "long" })
const chartDay = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })

export function CouncilOverviewPage() {
  const { meKeyId } = useCouncilContext()
  const now = Math.floor(Date.now() / 1000)
  const queue = useCouncilQueue().data
  const edits = useCouncilEdits().data?.items
  const applicants = useCouncilApplicants().data
  const stats = useCouncilOverview().data
  const open = queue && openItems(queue, now)
  const pending = applicants?.filter((a) => a.state === "pending_review")
  const oldestEdit = edits?.reduce<number | null>(
    (min, e) => (min === null || e.createdAt < min ? e.createdAt : min),
    null,
  )

  return (
    <div data-testid="council-overview">
      <PageHead
        title="Council"
        sub={
          <>
            {headDate.format(now * 1000)}
            {open && edits && pending ? (
              <>
                {" · "}
                <b>{open.length}</b> {open.length === 1 ? "open candidate" : "open candidates"}, <b>{edits.length}</b>{" "}
                {edits.length === 1 ? "edit" : "edits"}, <b>{pending.length}</b>{" "}
                {pending.length === 1 ? "applicant" : "applicants"}
              </>
            ) : null}
          </>
        }
        actions={
          <Link to="/council/queue" className={buttonClass("primary")}>
            Start reviewing
            <Kbd keys={["G", "Q"]} className="text-unison-bg/60" />
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 council:grid-cols-4">
        <StatTile
          label="Open in seal queue"
          value={open?.length}
          unit="candidates"
          foot={open ? <span>{open.filter((i) => now - i.createdAt < WEEK).length} new this week</span> : null}
        />
        <StatTile
          label="Edits waiting"
          value={edits?.length}
          unit="pending"
          foot={
            edits ? (
              <span>{oldestEdit == null ? "Nothing waiting" : `Oldest ${formatElapsed(now - oldestEdit)}`}</span>
            ) : null
          }
        />
        <StatTile
          label="Median time to decision"
          value={
            stats
              ? stats.medianDecisionHours.current === null
                ? "None"
                : Math.round(stats.medianDecisionHours.current)
              : undefined
          }
          unit={stats?.medianDecisionHours.current === null ? "" : "hours"}
          foot={
            stats ? (
              <MedianFoot current={stats.medianDecisionHours.current} previous={stats.medianDecisionHours.previous} />
            ) : null
          }
        />
        <StatTile
          label="Seal rate this month"
          value={stats ? (stats.sealRate === null ? "None" : `${Math.round(stats.sealRate * 100)}%`) : undefined}
          unit={stats?.sealRate === null ? "" : "of decisions"}
          foot={
            stats ? (
              <span>
                {stats.sealRate === null ? "No decisions yet" : "Seals mark the exceptional. Keep them rare."}
              </span>
            ) : null
          }
        />
      </div>

      <div className="mt-14 grid gap-14 council:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Region title="Needs you" sub="Sorted by urgency. Bookmarks from other members are left out.">
          {queue && edits && applicants ? (
            <Needs needs={deriveNeeds({ queue, edits, applicants, meKeyId, now })} />
          ) : (
            <ListSkeleton />
          )}
        </Region>
        <Region
          title="Council activity"
          aside={
            <Link
              to="/council/activity"
              className="inline-flex items-center gap-1 text-[13px] text-unison-text-muted transition-colors hover:text-unison-text"
            >
              See all
              <IconArrowRight aria-hidden className="size-3" stroke={1.5} />
            </Link>
          }
        >
          <Feed now={now} />
        </Region>
      </div>

      <div className="mt-14 grid gap-4 council:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <DecisionsChart />
        <WaitChart
          items={[
            ...(queue ?? []).map((i) => ({ song: i.song, since: i.createdAt })),
            ...(edits ?? []).map((e) => ({ song: e.song, since: e.createdAt })),
          ]}
          loaded={queue !== undefined && edits !== undefined}
          now={now}
        />
      </div>

      <Region className="mt-14" title={`Your ${monthName.format(now * 1000)}`} sub="Your own council work this month.">
        {stats ? (
          <div className="flex flex-wrap gap-3">
            <StatPill
              icon={IconRosetteDiscountCheck}
              value={stats.me.quota.used}
              suffix={`/${stats.me.quota.quota}`}
              label="seals used"
            />
            <StatPill icon={IconX} tone="reject" value={stats.me.rejectsThisMonth} label="rejections" />
            <StatPill icon={IconPencil} tone="edit" value={stats.me.editsThisMonth} label="edits reviewed" />
            {stats.me.medianDecisionHours === null ? null : (
              <StatPill
                icon={IconClock}
                tone="neutral"
                value={Math.round(stats.me.medianDecisionHours)}
                suffix="h"
                label="your median decision time"
              />
            )}
          </div>
        ) : (
          <Bone className="h-12 w-full max-w-xl" />
        )}
      </Region>
    </div>
  )
}

function Region({
  title,
  sub,
  aside,
  className,
  children,
}: {
  title: string
  sub?: string
  aside?: ReactNode
  className?: string
  children: ReactNode
}) {
  const id = `council-${title.toLowerCase().replace(/\W+/g, "-")}`
  return (
    <section aria-labelledby={id} className={className}>
      <SectionHead title={title} sub={sub} aside={aside} id={id} />
      {children}
    </section>
  )
}

function MedianFoot({ current, previous }: { current: number | null; previous: number | null }) {
  if (current === null) return <span>No decisions yet</span>
  if (previous === null) return <span>Nothing to compare with yet</span>
  return (
    <span className={cn("font-mono text-[11px]", current < previous && "text-[#86d98a]")}>
      {Math.round(previous)}h the 30 days before
    </span>
  )
}

function Needs({ needs }: { needs: ReturnType<typeof deriveNeeds> }) {
  if (needs.length === 0) {
    return (
      <EmptyState
        icon={<IconCheck className="size-5" stroke={1.5} />}
        title="All caught up"
        hint="Nothing needs your attention right now. New candidates show up here as they reach the queue."
      />
    )
  }
  return <NeedsList needs={needs} />
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {skeletonKeys("need", 3).map((key) => (
        <Bone key={key} className="h-[62px] w-full rounded-[10px]" />
      ))}
    </div>
  )
}

const FEED_SIZE = 6

function Feed({ now }: { now: number }) {
  const events = useCouncilFeed(FEED_SIZE).data?.events
  if (!events) return <ListSkeleton />
  if (events.length === 0) {
    return <p className="text-[13px] text-unison-text-muted">No council decisions yet.</p>
  }
  return (
    <ul className="flex flex-col">
      {events.map((event) => (
        <li key={event.id} className="flex gap-3 py-2.5 text-[13px] leading-[1.45] text-unison-text-secondary">
          {event.actor ? (
            <UserAvatar
              avatarUrl={event.actor.avatarUrl}
              keyId={event.actor.keyId}
              className="size-5 shrink-0 rounded-full object-cover outline outline-1 -outline-offset-1 outline-white/10"
              loading="lazy"
            />
          ) : (
            <span aria-hidden className="size-5 shrink-0 rounded-full bg-unison-bg-hover" />
          )}
          <EventSentence event={event} />
          <time
            dateTime={new Date(event.at * 1000).toISOString()}
            className="ml-auto pl-2 font-mono text-[11px] whitespace-nowrap text-unison-text-muted"
          >
            {formatElapsed(now - event.at)}
          </time>
        </li>
      ))}
    </ul>
  )
}

const SERIES = [
  { key: "sealed", label: "Sealed", color: TONE_COLOR.seal },
  { key: "rejected", label: "Rejected", color: TONE_COLOR.reject },
  { key: "editsReviewed", label: "Edits reviewed", color: TONE_COLOR.edit },
] as const

function DecisionsChart() {
  const [scope, setScope] = useState<"council" | "me">("council")
  const days: DayDecisions[] | undefined = useCouncilOverview(scope).data?.decisionsByDay
  const labels = days?.map((d) => chartDay.format(d.day * 1000)) ?? []
  const last = labels.length - 1
  return (
    <section aria-labelledby="council-decisions" className={`${cardClass} px-5 pt-5 pb-4`}>
      <ChartHead
        id="council-decisions"
        title="Decisions, last 30 days"
        sub="Every seal, rejection and edit review, from the web and from Discord."
      >
        <Segmented
          label="Whose decisions"
          value={scope}
          onChange={setScope}
          options={[
            { value: "council", label: "Council" },
            { value: "me", label: "You" },
          ]}
        />
      </ChartHead>
      {days ? (
        <StackedBars
          series={SERIES.map((s) => ({ ...s, values: days.map((d) => d[s.key]) }))}
          labels={labels}
          axisLabelAt={[0, 7, 14, 21, last].filter((i, k, all) => i <= last && all.indexOf(i) === k)}
          ariaLabel="Stacked bar chart of daily council decisions over 30 days"
        />
      ) : (
        <Bone className="h-[200px] w-full" />
      )}
    </section>
  )
}

function WaitChart({
  items,
  loaded,
  now,
}: {
  items: { song: string; since: number }[]
  loaded: boolean
  now: number
}) {
  const oldest = items.reduce<{ song: string; since: number } | null>(
    (best, item) => (best === null || item.since < best.since ? item : best),
    null,
  )
  return (
    <section aria-labelledby="council-waiting" className={`${cardClass} px-5 pt-5 pb-4`}>
      <ChartHead
        id="council-waiting"
        title="How long items wait"
        sub="Open seal candidates and pending edits, by time since they entered."
      />
      {loaded ? (
        <>
          <Histogram
            buckets={waitBuckets(
              items.map((i) => i.since),
              now,
            )}
            color={TONE_COLOR.edit}
            ariaLabel="Histogram of waiting time"
          />
          <p className="mt-2 text-xs text-unison-text-muted">
            {oldest ? (
              <>
                Oldest: <b className="font-medium text-unison-text-secondary">{oldest.song}</b>, waiting{" "}
                {formatElapsed(now - oldest.since)}.
              </>
            ) : (
              "Nothing is waiting."
            )}
          </p>
        </>
      ) : (
        <Bone className="h-[200px] w-full" />
      )}
    </section>
  )
}

function ChartHead({ id, title, sub, children }: { id: string; title: string; sub: string; children?: ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 id={id} className="text-sm font-semibold">
          {title}
        </h3>
        <p className="mt-0.5 text-xs text-unison-text-muted">{sub}</p>
      </div>
      {children}
    </div>
  )
}
