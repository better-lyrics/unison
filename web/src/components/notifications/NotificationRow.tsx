import { SongThumbnail } from "@/components/SongThumbnail"
import { UserAvatar } from "@/components/UserAvatar"
import { cn } from "@/lib/cn"
import { formatElapsed } from "@/lib/format"
import { notificationWords } from "@/lib/notification-words"
import type { NotificationItem } from "@/lib/types"
import { Link } from "react-router-dom"

const ROW_CLASS =
  "relative flex items-start gap-3.5 rounded-[10px] px-3 py-2.5 transition-[background-color] duration-150 ease-out before:absolute before:top-[27px] before:left-1 before:size-1.5 before:rounded-full before:bg-unison-unread before:opacity-0 before:transition-opacity before:duration-200 before:ease-out data-unread:before:opacity-100"

const LINK_CLASS = "outline-none hover:bg-white/[0.06] focus-visible:bg-white/[0.06]"

interface NotificationRowProps {
  item: NotificationItem
  now: number
  onNavigate: () => void
}

export function NotificationRow({ item, now, onNavigate }: NotificationRowProps) {
  const { parts, href } = notificationWords(item)
  const content = (
    <>
      <span className="relative ml-1 block size-10 shrink-0">
        {item.song ? (
          <SongThumbnail
            videoId={item.song.videoId}
            song={item.song.song}
            artist={item.song.artist}
            className="size-10"
          />
        ) : (
          <span className="block size-10 rounded-md bg-unison-bg-hover outline outline-1 -outline-offset-1 outline-white/10" />
        )}
        {item.actor ? (
          <UserAvatar
            avatarUrl={item.actor.avatarUrl}
            keyId={item.actor.keyId}
            loading="lazy"
            className="absolute -right-[5px] -bottom-[5px] size-5 rounded-full bg-unison-bg-hover shadow-[0_0_0_2px_#1c1a22]"
          />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] leading-5 text-pretty text-unison-text-secondary">
          {parts.map((part) => (
            <span
              key={`${part.strong ? "b" : "t"}:${part.text}`}
              className={part.strong ? "font-semibold text-unison-text" : undefined}
            >
              {part.text}
            </span>
          ))}
        </span>
        <span className="mt-[3px] block text-[11.5px] leading-4 text-unison-text-muted tabular-nums">
          {formatElapsed(Math.max(0, now - item.createdAt))} ago
        </span>
      </span>
    </>
  )

  if (!href) {
    return (
      <div data-unread={item.unread || undefined} className={ROW_CLASS}>
        {content}
      </div>
    )
  }
  return (
    <Link to={href} onClick={onNavigate} data-unread={item.unread || undefined} className={cn(ROW_CLASS, LINK_CLASS)}>
      {content}
    </Link>
  )
}
