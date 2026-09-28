import { UserAvatar } from "@/components/UserAvatar"
import { VariantBadge } from "@/components/VariantBadge"
import { useCouncilShortcuts } from "@/hooks/useCouncilShortcuts"
import { useLyricsVariants } from "@/hooks/useLyricsData"
import { cn } from "@/lib/cn"
import type { BookmarkState } from "@/lib/council-triage"
import type { BoostQuota, QueueItem } from "@/lib/council-types"
import { formatElapsed, formatRemaining, formatShortDate, titleCase } from "@/lib/format"
import { youTubeMusicUrl } from "@/lib/youtube-music"
import { IconAlertTriangle, IconBookmark, IconCheck, IconRosetteDiscountCheck } from "@tabler/icons-react"
import type { ReactNode } from "react"
import { ActionBar } from "./ActionBar"
import { CouncilHistory } from "./CouncilHistory"
import { LyricPreview } from "./LyricPreview"
import { BlockHead, Callout, Chip, DetailCard, DetailHeader, PersonCard } from "./detail-parts"

interface SealDetailProps {
  item: QueueItem
  meKeyId: string
  now: number
  quota: BoostQuota | null
  bookmark: BookmarkState
  bookmarkPending: boolean
  onBookmark: () => void
  onSeal: () => void
  onReject: (note: string | null) => void
  busy: boolean
}

export function SealDetail(props: SealDetailProps) {
  const { item, now, quota } = props
  useCouncilShortcuts({
    o: () => {
      window.open(youTubeMusicUrl(item.videoId), "_blank", "noreferrer")
    },
  })
  const remaining = quota?.remaining ?? 0

  return (
    <DetailCard
      actions={
        <ActionBar
          key={item.id}
          bookmark={props.bookmark}
          bookmarkPending={props.bookmarkPending}
          onBookmark={props.onBookmark}
          primary={{
            label: "Seal",
            icon: IconRosetteDiscountCheck,
            shortcut: "S",
            confirmTitle: `Seal “${item.song}”?`,
            confirmBody: `This uses 1 of your ${remaining} remaining seals this month. The lyric gets the council mark and ranks higher, and your name shows on the seal.`,
            confirmLabel: "Seal lyric",
            unavailable: quota && remaining <= 0 ? `No seals left until ${formatShortDate(quota.resetsAt)}` : null,
          }}
          onPrimary={props.onSeal}
          reject={{ submitLabel: "Reject lyric", hint: "Optional. Shown in the activity log and on the Discord card." }}
          onReject={props.onReject}
          busy={props.busy}
        />
      }
    >
      <DetailHeader
        videoId={item.videoId}
        title={item.song}
        artist={item.artist}
        chips={
          <>
            <VariantBadge format={item.format} syncType={item.syncType} className="h-6 px-2" />
            {item.language ? <Chip>{item.language.toUpperCase()}</Chip> : null}
            <Chip>{titleCase(item.confidence)} confidence</Chip>
            {item.variants > 1 ? <Chip>{item.variants} variants</Chip> : null}
          </>
        }
      />
      <div>
        <BlockHead title="Submitter" />
        {item.submitter ? (
          <PersonCard
            person={item.submitter}
            sub={
              <>
                <span className="font-mono">{item.submitter.reputation.toFixed(2)}</span> reputation ·{" "}
                <span className="font-mono">{item.submitter.submissions}</span> submissions ·{" "}
                <span className="font-mono">{item.submitter.sealed}</span> sealed before
              </>
            }
          />
        ) : (
          <p className="text-[13px] text-unison-text-muted">The submitter account no longer exists.</p>
        )}
      </div>
      <BookmarkCallout item={item} meKeyId={props.meKeyId} now={now} />
      <div className="grid grid-cols-2 gap-6 min-[860px]:grid-cols-4">
        <Fact label="Effective score" value={item.score.toFixed(2)} sub="Reputation-weighted" />
        <Fact
          label="Votes"
          value={
            <>
              {item.upvotes} <span className="text-[13px] text-unison-text-muted">/ {item.downvotes}</span>
            </>
          }
          sub={<VoteSplit up={item.upvotes} down={item.downvotes} />}
        />
        <Fact label="Waiting" value={formatElapsed(now - item.createdAt)} sub="Since submission" />
        <Fact
          label="Requests"
          value={String(item.requestsFilled)}
          sub={item.requestsFilled > 0 ? "Listener requests it filled" : "No listener requests"}
        />
      </div>
      <div>
        <BlockHead title="Automatic checks" aside="Hints, not rules" />
        <div className="flex flex-wrap gap-1.5">
          {item.flags.length > 0 ? (
            item.flags.map((flag) => (
              <Chip key={flag.code} tone="warn">
                <IconAlertTriangle aria-hidden className="size-3" stroke={1.5} />
                {flag.label}
              </Chip>
            ))
          ) : (
            <Chip tone="good">
              <IconCheck aria-hidden className="size-3" stroke={1.5} />
              No automatic flags
            </Chip>
          )}
        </div>
      </div>
      <LyricPreview key={item.id} lyricId={item.id} videoId={item.videoId} />
      <OtherVariants item={item} />
      <div>
        <BlockHead title="Council history" />
        <CouncilHistory lyricId={item.id} now={now} />
      </div>
    </DetailCard>
  )
}

function BookmarkCallout({ item, meKeyId, now }: { item: QueueItem; meKeyId: string; now: number }) {
  const bookmark = item.bookmark
  if (!bookmark || bookmark.expiresAt <= now) return null
  const age = formatElapsed(now - bookmark.createdAt)
  const left = formatRemaining(bookmark.expiresAt - now)
  const icon = <IconBookmark aria-hidden className="mt-0.5 size-4 shrink-0" stroke={1.5} />
  if (bookmark.holder.keyId === meKeyId) {
    return (
      <Callout icon={icon}>
        <b>You bookmarked this {age} ago.</b> Other members skip it until you decide or release it. {left} left.
      </Callout>
    )
  }
  return (
    <Callout icon={icon} tone="warn">
      <b>
        {bookmark.holder.displayName} bookmarked this {age} ago.
      </b>{" "}
      They are probably reviewing it. It goes back to the open queue in {left}.
    </Callout>
  )
}

function Fact({ label, value, sub }: { label: string; value: ReactNode; sub: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-[0.08em] text-unison-text-muted">{label}</div>
      <div className="mt-1.5 font-mono text-base font-medium tabular-nums">{value}</div>
      <div className="mt-1 text-[11px] text-unison-text-muted">{sub}</div>
    </div>
  )
}

function VoteSplit({ up, down }: { up: number; down: number }) {
  if (up + down === 0) return <>No votes yet</>
  return (
    <span role="img" className="mt-1 flex h-1 gap-0.5" aria-label={`${up} up, ${down} down`}>
      <i className="block rounded-[2px] bg-[#86d98a]" style={{ flex: up }} />
      <i className="block rounded-[2px] bg-[#f7c46c]" style={{ flex: Math.max(down, 0.001) }} />
    </span>
  )
}

function OtherVariants({ item }: { item: QueueItem }) {
  const variants = useLyricsVariants(item.videoId).data?.variants
  if (!variants || variants.length < 2) return null
  return (
    <div>
      <BlockHead title="Other variants for this song" aside="The queue shows the top-ranked one" />
      <ul className="flex flex-col gap-1">
        {variants.map((v) => (
          <li
            key={v.id}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px]",
              v.id === item.id ? "bg-white/[0.05]" : "bg-white/[0.02]",
            )}
          >
            <VariantBadge format={v.format} />
            <span className="flex min-w-0 flex-1 items-center gap-2 text-unison-text-secondary">
              {v.submitter ? (
                <UserAvatar
                  avatarUrl={v.submitter.avatarUrl}
                  keyId={v.submitter.keyId}
                  className="size-[18px] rounded-full object-cover"
                  loading="lazy"
                />
              ) : null}
              <span className="truncate">
                {v.submitter?.displayName ?? "Unknown submitter"}
                {v.id === item.id ? " · this one" : ""}
              </span>
            </span>
            <span className="font-mono">{v.effectiveScore.toFixed(2)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
