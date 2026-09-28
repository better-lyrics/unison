import { cn } from "@/lib/cn"
import type { Need, NeedKind } from "@/lib/council-needs"
import {
  type Icon,
  IconAlertTriangle,
  IconArrowRight,
  IconBookmark,
  IconClock,
  IconRosetteDiscountCheck,
  IconSchool,
} from "@tabler/icons-react"
import { Link } from "react-router-dom"

const ICONS: Record<NeedKind, Icon> = {
  "sealed-edit": IconRosetteDiscountCheck,
  "flagged-edit": IconAlertTriangle,
  "my-bookmarks": IconBookmark,
  "expiring-bookmark": IconClock,
  applicants: IconSchool,
}

const TONES: Record<Need["tone"], string> = {
  gold: "bg-unison-medal-gold-wash text-unison-medal-gold",
  warn: "bg-[rgba(245,166,35,0.1)] text-unison-warn",
  plain: "bg-unison-surface text-unison-text-secondary",
}

export function NeedsList({ needs }: { needs: Need[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {needs.map((need) => {
        const NeedIcon = ICONS[need.kind]
        return (
          <li key={need.kind}>
            <Link
              to={need.to}
              className="group flex w-full items-center gap-3.5 rounded-[10px] bg-white/[0.02] px-4 py-3.5 text-left transition-colors hover:bg-unison-bg-hover"
            >
              <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", TONES[need.tone])}>
                <NeedIcon className="size-4" stroke={1.5} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{need.title}</span>
                <span className="mt-0.5 block text-xs text-unison-text-muted">{need.sub}</span>
              </span>
              <IconArrowRight
                aria-hidden
                className="size-4 text-unison-text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                stroke={1.5}
              />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
