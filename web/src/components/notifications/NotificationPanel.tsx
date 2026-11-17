import { EmptyState } from "@/components/EmptyState"
import { buttonClass, popoverSurfaceClass } from "@/components/ui"
import { useNotificationList } from "@/hooks/useNotifications"
import { useScrollEdges } from "@/hooks/useScrollEdges"
import { cn } from "@/lib/cn"
import {
  NOTIFICATIONS_EMPTY,
  NOTIFICATIONS_ERROR,
  NOTIFICATIONS_TITLE,
  NOTIFICATION_GROUP_LABELS,
  newCountLabel,
} from "@/lib/notification-words"
import type { NotificationGroup, NotificationItem } from "@/lib/types"
import { IconBell } from "@tabler/icons-react"
import { useState } from "react"
import { NotificationRow } from "./NotificationRow"

const GROUP_ORDER: NotificationGroup[] = ["lyrics", "suggestions"]

interface NotificationPanelProps {
  open: boolean
  closing: boolean
  unread: number
  onClose: () => void
}

export function NotificationPanel({ open, closing, unread, onClose }: NotificationPanelProps) {
  const list = useNotificationList(open)
  const [pane, setPane] = useState<HTMLDivElement | null>(null)
  const edges = useScrollEdges(pane)
  const items = list.data?.items
  const count = list.data?.unread ?? unread
  const now = Math.floor(Date.now() / 1000)

  return (
    <dialog
      open
      aria-label={NOTIFICATIONS_TITLE}
      data-origin="top-right"
      className={cn(
        popoverSurfaceClass,
        "t-dropdown absolute inset-x-2.5 top-full z-20 m-0 mt-2 h-auto w-auto overflow-hidden rounded-2xl border-0 p-0 sm:inset-x-auto sm:right-0 sm:w-[380px]",
        closing && "is-closing",
      )}
    >
      <div className="flex items-baseline px-[18px] pt-3.5 pb-1.5 text-[13px] font-bold">
        {NOTIFICATIONS_TITLE}
        {count > 0 ? (
          <span className="ml-2 text-[11px] font-semibold text-unison-text-muted tabular-nums">
            {newCountLabel(count)}
          </span>
        ) : null}
      </div>
      {!items && list.isError ? (
        <div className="px-1.5 pb-1.5">
          <EmptyState title={NOTIFICATIONS_ERROR.title} icon={<IconBell className="size-5" stroke={1.5} />}>
            <button type="button" className={buttonClass("fill", "sm")} onClick={() => list.refetch()}>
              {NOTIFICATIONS_ERROR.retry}
            </button>
          </EmptyState>
        </div>
      ) : items && items.length === 0 ? (
        <div className="px-1.5 pb-1.5">
          <EmptyState
            title={NOTIFICATIONS_EMPTY.title}
            hint={NOTIFICATIONS_EMPTY.body}
            icon={<IconBell className="size-5" stroke={1.5} />}
          />
        </div>
      ) : (
        <div ref={setPane} className={cn("scroll-fade", edges.up && "[--ft:28px]", edges.down && "[--fb:28px]")}>
          <div
            data-scroller
            className="max-h-[440px] overflow-auto overscroll-contain px-1.5 pb-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {items ? <NotificationGroups items={items} now={now} onNavigate={onClose} /> : <NotificationSkeleton />}
          </div>
        </div>
      )}
    </dialog>
  )
}

function NotificationGroups({
  items,
  now,
  onNavigate,
}: {
  items: NotificationItem[]
  now: number
  onNavigate: () => void
}) {
  return GROUP_ORDER.map((group) => {
    const rows = items.filter((item) => item.group === group).sort((a, b) => b.createdAt - a.createdAt)
    if (rows.length === 0) return null
    return (
      <section key={group}>
        <h3 className="px-3 pt-3 pb-1 text-[11px] font-semibold text-unison-text-muted">
          {NOTIFICATION_GROUP_LABELS[group]}
        </h3>
        {rows.map((item) => (
          <NotificationRow key={item.id} item={item} now={now} onNavigate={onNavigate} />
        ))}
      </section>
    )
  })
}

function NotificationSkeleton() {
  return (
    <div aria-hidden="true" className="pt-1.5">
      {[0, 1].map((row) => (
        <div key={row} className="flex items-start gap-3.5 px-3 py-2.5">
          <span className="ml-1 size-10 shrink-0 animate-pulse rounded-md bg-unison-bg-hover" />
          <span className="flex-1 space-y-2 pt-1">
            <span className="block h-3 w-4/5 animate-pulse rounded bg-unison-bg-hover" />
            <span className="block h-2.5 w-1/4 animate-pulse rounded bg-unison-bg-hover" />
          </span>
        </div>
      ))}
    </div>
  )
}
