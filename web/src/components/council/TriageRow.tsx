import { SongThumbnail } from "@/components/SongThumbnail"
import { UserAvatar } from "@/components/UserAvatar"
import { VariantBadge } from "@/components/VariantBadge"
import { tagClass } from "@/components/ui"
import type { Bookmarkable, Triage } from "@/hooks/useTriage"
import { cn } from "@/lib/cn"
import { changedFields } from "@/lib/council-metadata"
import { reasonLabel, reasonMetric } from "@/lib/council-reasons"
import type { BookmarkView, EditItem, MetadataItem, QueueItem } from "@/lib/council-types"
import { formatElapsed, formatRemaining } from "@/lib/format"
import { IconAlertTriangle, IconBookmark, IconBookmarkFilled } from "@tabler/icons-react"
import type { ReactNode } from "react"
import { Link } from "react-router-dom"

const SOON_SEC = 12 * 3600

interface TriageRowProps<T extends Bookmarkable & { videoId: string; song: string }> {
  triage: Triage<T>
  itemKey: string
  item: T
  title: string
  sub: string
  meta: ReactNode
  end: ReactNode
  bookmarkable?: boolean
}

export function TriageRow<T extends Bookmarkable & { videoId: string; song: string }>({
  triage,
  itemKey,
  item,
  title,
  sub,
  meta,
  end,
  bookmarkable = true,
}: TriageRowProps<T>) {
  const selected = triage.selectedKey === itemKey
  const heldByOther = triage.heldByOther(item)
  const showToggle = bookmarkable && !heldByOther
  return (
    <li className="relative">
      <Link
        to={triage.hrefFor(itemKey)}
        replace
        data-key={itemKey}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex w-full items-center gap-3 rounded-[10px] bg-white/[0.02] py-3 pl-3.5 text-left transition-[background-color,opacity] duration-150 hover:bg-unison-bg-hover",
          showToggle ? "pr-[54px]" : "pr-3.5",
          selected && "bg-unison-bg-hover shadow-inset-rim",
          heldByOther && !selected && "opacity-60 hover:opacity-100",
        )}
      >
        <SongThumbnail videoId={item.videoId} className="size-11" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm leading-tight font-medium">{title}</div>
          <div className="mt-px truncate text-xs leading-tight text-unison-text-secondary">{sub}</div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-unison-text-muted">{meta}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">{end}</div>
      </Link>
      {showToggle ? (
        <div className="absolute top-1/2 right-3.5 -translate-y-1/2">
          <BookmarkToggle
            on={triage.bookmarkState(item).kind === "mine"}
            song={item.song}
            disabled={triage.bookmarkPending}
            onToggle={() => triage.toggleBookmark(item)}
          />
        </div>
      ) : null}
    </li>
  )
}

export function Sep() {
  return (
    <span aria-hidden className="opacity-40">
      ·
    </span>
  )
}

export function BookmarkToggle({
  on,
  song,
  disabled,
  onToggle,
}: {
  on: boolean
  song: string
  disabled?: boolean
  onToggle: () => void
}) {
  const Icon = on ? IconBookmarkFilled : IconBookmark
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={`${on ? "Release bookmark on" : "Bookmark"} ${song}`}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "relative grid size-7 cursor-pointer place-items-center rounded-md transition-colors after:absolute after:-inset-1.5 hover:bg-unison-bg-hover disabled:cursor-not-allowed disabled:opacity-50",
        on ? "text-unison-medal-gold" : "text-unison-text-muted hover:text-unison-text",
      )}
    >
      <Icon className="size-4" stroke={1.5} />
    </button>
  )
}

export function BookmarkClaim({ bookmark, now }: { bookmark: BookmarkView; now: number }) {
  const left = bookmark.expiresAt - now
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[5px] text-[11px]",
        left < SOON_SEC ? "text-unison-warn" : "text-unison-text-secondary",
      )}
    >
      <UserAvatar
        avatarUrl={bookmark.holder.avatarUrl}
        keyId={bookmark.holder.keyId}
        className="size-4 rounded-full object-cover outline outline-1 -outline-offset-1 outline-white/10"
        loading="lazy"
      />
      <span className="sr-only">Bookmarked by {bookmark.holder.displayName},</span>
      {formatRemaining(left)} left
    </span>
  )
}

export function queueRowParts(item: QueueItem, heldByOther: boolean, now: number, outside = false) {
  return {
    title: item.song,
    sub: [item.artist, item.submitter?.displayName].filter(Boolean).join(" · "),
    meta: (
      <>
        {outside ? (
          <>
            <span className="text-unison-text-secondary">Not in the queue</span>
            <Sep />
          </>
        ) : null}
        <VariantBadge format={item.format} />
        {item.language ? <span>{item.language.toUpperCase()}</span> : null}
        <Sep />
        <span>{formatElapsed(now - item.createdAt)} waiting</span>
        {item.flags.length > 0 ? (
          <>
            <Sep />
            <span className="inline-flex items-center gap-[3px] text-[#f7c46c]">
              <IconAlertTriangle aria-hidden className="size-3" stroke={1.5} />
              <span className="sr-only">Automatic flags:</span>
              {item.flags.length}
            </span>
          </>
        ) : null}
      </>
    ),
    end:
      heldByOther && item.bookmark ? (
        <BookmarkClaim bookmark={item.bookmark} now={now} />
      ) : (
        <>
          <span className="font-mono text-[13px] tabular-nums">{item.score.toFixed(2)}</span>
          <span className="font-mono text-[11px] text-unison-text-muted tabular-nums">{item.voteCount} votes</span>
        </>
      ),
  }
}

export function metadataRowParts(item: MetadataItem, needed: number, now: number) {
  return {
    title: item.song,
    sub: [item.artist, item.proposer?.displayName].filter(Boolean).join(" · "),
    meta: (
      <>
        <span className={tagClass}>{changedFields(item).join(", ")}</span>
        <Sep />
        <span>{formatElapsed(now - item.createdAt)}</span>
      </>
    ),
    end: (
      <span className="font-mono text-[11px] text-unison-text-muted">
        {item.approvers.length} of {needed}
      </span>
    ),
  }
}

export function editRowParts(edit: EditItem, heldByOther: boolean, now: number) {
  return {
    title: edit.song,
    sub: [edit.artist, edit.author?.displayName].filter(Boolean).join(" · "),
    meta: (
      <>
        <span className={tagClass}>Rev {edit.revNo}</span>
        <span>{reasonLabel(edit.pendingReason)}</span>
        <Sep />
        <span>{formatElapsed(now - edit.createdAt)}</span>
      </>
    ),
    end:
      heldByOther && edit.bookmark ? (
        <BookmarkClaim bookmark={edit.bookmark} now={now} />
      ) : (
        <span className="font-mono text-[11px] text-unison-text-muted">{reasonMetric(edit)}</span>
      ),
  }
}
