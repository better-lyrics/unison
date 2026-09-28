import { AuthorBadges } from "@/components/AuthorBadges"
import { Kbd } from "@/components/Kbd"
import { SongThumbnail } from "@/components/SongThumbnail"
import { UserAvatar } from "@/components/UserAvatar"
import { YouTubeMusicIcon } from "@/components/icons/YouTubeMusicIcon"
import { buttonClass } from "@/components/ui"
import { cn } from "@/lib/cn"
import type { CouncilPerson } from "@/lib/council-types"
import { youTubeMusicUrl } from "@/lib/youtube-music"
import { IconExternalLink } from "@tabler/icons-react"
import type { ReactNode } from "react"
import { cardClass } from "./headings"

export function DetailCard({ children, actions }: { children: ReactNode; actions: ReactNode }) {
  return (
    <section aria-label="Details" className={cardClass}>
      <div className="flex flex-col gap-9 p-8">{children}</div>
      {actions}
    </section>
  )
}

export function DetailHeader({
  videoId,
  title,
  artist,
  chips,
}: {
  videoId: string
  title: string
  artist: string
  chips: ReactNode
}) {
  return (
    <div className="flex items-start gap-[22px]">
      <SongThumbnail
        videoId={videoId}
        className="size-[104px] rounded-xl outline outline-1 -outline-offset-1 outline-white/10"
      />
      <div className="min-w-0">
        <h2 className="text-[26px] leading-[1.2] font-bold tracking-[-0.01em] text-balance">{title}</h2>
        <div className="mt-1 text-sm text-unison-text-secondary">{artist}</div>
        <div className="mt-3 flex flex-wrap gap-1.5">{chips}</div>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <a href={youTubeMusicUrl(videoId)} target="_blank" rel="noreferrer" className={buttonClass("primary", "sm")}>
            <YouTubeMusicIcon aria-hidden className="size-4" />
            Open in YouTube Music
            <Kbd keys={["O"]} />
          </a>
          <a
            href={`/song/${encodeURIComponent(videoId)}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-[5px] text-xs text-unison-text-muted transition-colors hover:text-unison-text"
          >
            <IconExternalLink aria-hidden className="size-3" stroke={1.5} />
            Song page
          </a>
        </div>
      </div>
    </div>
  )
}

const CHIP_TONES = {
  plain: "bg-unison-surface text-unison-text-secondary shadow-[inset_0_0_0_1px_var(--color-unison-border)]",
  warn: "bg-[rgba(245,166,35,0.08)] text-[#f7c46c] shadow-[inset_0_0_0_1px_rgba(245,166,35,0.2)]",
  good: "bg-[rgba(12,163,12,0.08)] text-[#86d98a] shadow-[inset_0_0_0_1px_rgba(12,163,12,0.22)]",
  gold: "bg-unison-medal-gold-wash text-unison-medal-gold",
}

export function Chip({ tone = "plain", children }: { tone?: keyof typeof CHIP_TONES; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium",
        CHIP_TONES[tone],
      )}
    >
      {children}
    </span>
  )
}

export function Callout({
  icon,
  tone = "plain",
  children,
}: { icon: ReactNode; tone?: "plain" | "warn"; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-[10px] px-3.5 py-3 text-[13px] leading-normal text-unison-text-secondary [&_b]:font-semibold [&_b]:text-unison-text",
        tone === "warn"
          ? "bg-[rgba(245,166,35,0.07)] shadow-[inset_0_0_0_1px_rgba(245,166,35,0.16)] [&>svg]:text-unison-warn"
          : "bg-white/[0.04]",
      )}
    >
      {icon}
      <div>{children}</div>
    </div>
  )
}

export function BlockHead({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="mb-3.5 flex items-center justify-between gap-3">
      <h3 className="text-[13px] font-semibold">{title}</h3>
      {aside ? <div className="flex items-center gap-2.5 text-xs text-unison-text-muted">{aside}</div> : null}
    </div>
  )
}

export function PersonCard({ person, sub }: { person: CouncilPerson; sub: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <UserAvatar
        avatarUrl={person.avatarUrl}
        keyId={person.keyId}
        className="size-10 shrink-0 rounded-full object-cover outline outline-1 -outline-offset-1 outline-white/10"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {person.displayName}
          <AuthorBadges {...person} />
        </div>
        <div className="mt-[3px] text-xs text-unison-text-muted">{sub}</div>
      </div>
    </div>
  )
}

export const historyItemClass =
  "relative pb-3.5 pl-5 text-[13px] leading-normal text-unison-text-secondary before:absolute before:top-[7px] before:left-[3px] before:size-[7px] before:rounded-full before:bg-unison-text-muted before:content-['']"
