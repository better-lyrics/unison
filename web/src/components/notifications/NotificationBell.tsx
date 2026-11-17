import { IconSwap } from "@/components/icons/IconSwap"
import { glassClass } from "@/components/ui"
import { useMarkSeen, useUnreadCount } from "@/hooks/useNotifications"
import { usePresence } from "@/hooks/usePresence"
import { cn } from "@/lib/cn"
import { NOTIFICATIONS_TITLE, newCountLabel } from "@/lib/notification-words"
import { IconBell, IconBellFilled } from "@tabler/icons-react"
import { useEffect, useRef, useState } from "react"
import { NotificationPanel } from "./NotificationPanel"

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const presence = usePresence(open)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const swingRef = useRef<HTMLSpanElement | null>(null)
  const previousUnread = useRef<number | null>(null)
  const unread = useUnreadCount(true).data?.unread ?? 0
  const markSeen = useMarkSeen()
  const hasUnread = unread > 0

  const close = () => {
    setOpen(false)
    if (hasUnread) markSeen.mutate()
  }
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    const previous = previousUnread.current
    previousUnread.current = unread
    const el = swingRef.current
    if (!el || unread <= (previous ?? 0)) return
    el.removeAttribute("data-ringing")
    void el.offsetWidth
    el.setAttribute("data-ringing", "")
  }, [unread])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) closeRef.current()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current()
    }
    document.addEventListener("mousedown", onClick)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div ref={wrapperRef} className="sm:relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={hasUnread ? `${NOTIFICATIONS_TITLE}, ${newCountLabel(unread)}` : NOTIFICATIONS_TITLE}
        className={cn(
          glassClass,
          "relative grid size-9 cursor-pointer place-items-center rounded-full text-(--ink-2) transition-[background-color,color,scale] duration-150 ease-out after:absolute after:-inset-0.5 after:rounded-[inherit] hover:bg-white/[0.14] hover:text-unison-text active:scale-[0.96] aria-expanded:bg-white/[0.14] aria-expanded:text-unison-text motion-reduce:active:scale-100",
          hasUnread && "text-unison-text",
        )}
      >
        <span
          ref={swingRef}
          onAnimationEnd={(e) => e.currentTarget.removeAttribute("data-ringing")}
          className="bell-swing relative grid size-[18px]"
        >
          <IconSwap
            swapped={hasUnread}
            from={<IconBell className="size-full" stroke={1.5} />}
            to={<IconBellFilled className="cutout size-full [--cut-r:5px] [--cut-x:15px] [--cut-y:3px]" />}
            className="size-full"
          />
          <span aria-hidden="true" data-on={hasUnread || undefined} className="bell-pip" />
        </span>
      </button>
      {presence.mounted ? (
        <NotificationPanel open={open} closing={presence.closing} unread={unread} onClose={close} />
      ) : null}
    </div>
  )
}
