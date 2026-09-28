import { Kbd } from "@/components/Kbd"
import {
  useCouncilApplicants,
  useCouncilEdits,
  useCouncilMembers,
  useCouncilOverview,
  useCouncilQueue,
} from "@/hooks/useCouncilData"
import { cn } from "@/lib/cn"
import { groupByBookmark, openItems } from "@/lib/council-triage"
import type { BoostQuota, EditItem, QueueItem } from "@/lib/council-types"
import { formatShortDate, titleCase } from "@/lib/format"
import type { TierName } from "@/lib/types"
import {
  type Icon,
  IconBookmark,
  IconCommand,
  IconHistory,
  IconKeyboard,
  IconLayoutDashboard,
  IconPencil,
  IconRosetteDiscountCheck,
  IconSchool,
  IconUsers,
} from "@tabler/icons-react"
import { NavLink } from "react-router-dom"

type SectionId = "overview" | "queue" | "edits" | "bookmarks" | "applicants" | "activity" | "members"

interface Section {
  id: SectionId
  to: string
  label: string
  icon: Icon
}

export const COUNCIL_SECTIONS: Section[] = [
  { id: "overview", to: "/council", label: "Overview", icon: IconLayoutDashboard },
  { id: "queue", to: "/council/queue", label: "Seal queue", icon: IconRosetteDiscountCheck },
  { id: "edits", to: "/council/edits", label: "Edits", icon: IconPencil },
  { id: "bookmarks", to: "/council/bookmarks", label: "Bookmarks", icon: IconBookmark },
  { id: "applicants", to: "/council/applicants", label: "Applicants", icon: IconSchool },
  { id: "activity", to: "/council/activity", label: "Activity", icon: IconHistory },
  { id: "members", to: "/council/members", label: "Members", icon: IconUsers },
]

interface SectionCount {
  value: string
  hot?: boolean
}

function useSectionCounts(meKeyId: string): Partial<Record<SectionId, SectionCount>> {
  const now = Math.floor(Date.now() / 1000)
  const queue = useCouncilQueue().data
  const edits = useCouncilEdits().data
  const overview = useCouncilOverview().data
  const applicants = useCouncilApplicants().data
  const members = useCouncilMembers().data
  const counts: Partial<Record<SectionId, SectionCount>> = {}
  if (queue) counts.queue = { value: String(openItems(queue, now).length) }
  if (edits) {
    counts.edits = {
      value: String(edits.items.length),
      hot: edits.items.some((e) => e.pendingReason === "sealed"),
    }
  }
  if (queue && edits && overview) {
    const mine = groupByBookmark<QueueItem | EditItem>([...queue, ...edits.items], meKeyId, now).mine.length
    counts.bookmarks = { value: `${mine}/${overview.me.bookmarkCap}` }
  }
  if (applicants) counts.applicants = { value: String(applicants.filter((a) => a.state === "pending_review").length) }
  if (members) counts.members = { value: String(members.length) }
  return counts
}

export function CouncilRail({
  meKeyId,
  onOpenMenu,
  onOpenKeys,
}: {
  meKeyId: string
  onOpenMenu: () => void
  onOpenKeys: () => void
}) {
  const counts = useSectionCounts(meKeyId)
  return (
    <aside className="max-council:pt-8 max-council:pb-6 council:sticky council:top-(--app-header-h) council:flex council:h-[calc(100dvh-var(--app-header-h))] council:flex-col council:gap-6 council:self-start council:overflow-y-auto council:py-8">
      <div>
        <div className="hidden px-2.5 pb-1.5 text-[10px] uppercase tracking-[0.08em] text-unison-text-muted council:block">
          Council
        </div>
        <nav
          aria-label="Council sections"
          className="flex gap-1 overflow-x-auto [scrollbar-width:none] council:flex-col council:gap-0.5 council:overflow-visible"
        >
          {COUNCIL_SECTIONS.map((section) => (
            <RailLink key={section.id} section={section} count={counts[section.id]} />
          ))}
        </nav>
      </div>
      <QuotaCard />
      <div className="mt-auto hidden flex-col gap-2 px-2.5 text-xs text-unison-text-muted council:flex">
        <RailFootButton icon={IconCommand} label="Command menu" keys={["Mod", "K"]} onClick={onOpenMenu} />
        <RailFootButton icon={IconKeyboard} label="Keyboard shortcuts" keys={["?"]} onClick={onOpenKeys} />
      </div>
    </aside>
  )
}

function RailLink({ section, count }: { section: Section; count: SectionCount | undefined }) {
  const SectionIcon = section.icon
  return (
    <NavLink
      to={section.to}
      end
      className={({ isActive }) =>
        cn(
          "group flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium text-unison-text-secondary transition-colors hover:bg-unison-bg-hover hover:text-unison-text",
          "council:w-full council:gap-2.5 council:rounded-lg council:px-2.5 council:py-[7px] council:leading-[18px]",
          isActive && "bg-unison-bg-elevated text-unison-text council:bg-unison-bg-hover council:shadow-inset-rim",
        )
      }
    >
      <SectionIcon
        aria-hidden
        className="hidden size-4 opacity-70 group-aria-[current=page]:opacity-100 council:block"
        stroke={1.5}
      />
      {section.label}
      {count ? (
        <span
          data-count
          data-hot={count.hot ? "true" : undefined}
          className={cn(
            "font-mono text-[11px] tabular-nums text-unison-text-muted council:ml-auto",
            count.hot && "text-unison-medal-gold",
          )}
        >
          {count.value}
        </span>
      ) : null}
    </NavLink>
  )
}

function RailFootButton({
  icon: FootIcon,
  label,
  keys,
  onClick,
}: {
  icon: Icon
  label: string
  keys: string[]
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer items-center gap-2 text-left transition-colors hover:text-unison-text"
    >
      <FootIcon aria-hidden className="size-3.5" stroke={1.5} />
      {label}
      <Kbd keys={keys} className="ml-auto" />
    </button>
  )
}

function QuotaCard() {
  const overview = useCouncilOverview().data
  const me = useCouncilMembers().data?.find((m) => m.isYou)
  if (!overview) return null
  return <QuotaRingCard quota={overview.me.quota} tier={me?.tier ?? null} />
}

const RING_RADIUS = 15
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

function QuotaRingCard({ quota, tier }: { quota: BoostQuota; tier: TierName | null }) {
  const spent = quota.quota === 0 ? 1 : quota.used / quota.quota
  return (
    <div
      data-testid="quota-card"
      className="hidden items-center gap-3 rounded-xl bg-white/[0.02] p-3.5 shadow-inset-rim council:flex"
    >
      <svg width="40" height="40" viewBox="0 0 40 40" className="-rotate-90" aria-hidden="true">
        <circle cx="20" cy="20" r={RING_RADIUS} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3.5" />
        <circle
          cx="20"
          cy="20"
          r={RING_RADIUS}
          fill="none"
          stroke="var(--color-unison-medal-gold)"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * Math.min(1, spent)}
          className="transition-[stroke-dashoffset] duration-600 ease-[cubic-bezier(0.2,0,0,1)]"
        />
      </svg>
      <div>
        <b className="block text-[13px] font-semibold">
          <span className="font-mono tabular-nums">{quota.remaining}</span> of{" "}
          <span className="font-mono tabular-nums">{quota.quota}</span> seals left
        </b>
        <small className="mt-0.5 block text-[11px] text-unison-text-muted">
          {tier ? titleCase(tier) : "Monthly"} quota · resets {formatShortDate(quota.resetsAt)}
        </small>
      </div>
    </div>
  )
}
