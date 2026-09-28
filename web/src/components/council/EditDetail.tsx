import { Bone } from "@/components/skeleton"
import { useCouncilShortcuts } from "@/hooks/useCouncilShortcuts"
import { useRevisionDiff, useRevisions } from "@/hooks/useLyricsData"
import { cn } from "@/lib/cn"
import { reasonLabel, reasonWhy } from "@/lib/council-reasons"
import type { BookmarkState } from "@/lib/council-triage"
import type { EditItem, EditThresholds } from "@/lib/council-types"
import { formatElapsed } from "@/lib/format"
import type { RevisionSummary } from "@/lib/revision-types"
import { youTubeMusicUrl } from "@/lib/youtube-music"
import { IconAlertTriangle, IconCheck, IconRosetteDiscountCheck } from "@tabler/icons-react"
import { useState } from "react"
import { ActionBar } from "./ActionBar"
import { type DiffMode, DiffView } from "./DiffView"
import { Segmented } from "./Segmented"
import { BlockHead, Callout, Chip, DetailCard, DetailHeader, PersonCard, historyItemClass } from "./detail-parts"

interface EditDetailProps {
  item: EditItem
  thresholds: EditThresholds
  now: number
  bookmark: BookmarkState
  bookmarkPending: boolean
  onBookmark: () => void
  onApprove: () => void
  onReject: (note: string | null) => void
  busy: boolean
}

const pct = (value: number) => `${Math.round(value * 100)}%`

export function EditDetail(props: EditDetailProps) {
  const { item, thresholds, now } = props
  const [mode, setMode] = useState<DiffMode>("unified")
  useCouncilShortcuts({
    o: () => {
      window.open(youTubeMusicUrl(item.videoId), "_blank", "noreferrer")
    },
  })
  const sealed = item.pendingReason === "sealed"
  const ReasonIcon = sealed ? IconRosetteDiscountCheck : IconAlertTriangle

  return (
    <DetailCard
      actions={
        <ActionBar
          key={item.revisionId}
          bookmark={props.bookmark}
          bookmarkPending={props.bookmarkPending}
          onBookmark={props.onBookmark}
          primary={{
            label: "Approve",
            icon: IconCheck,
            shortcut: "A",
            confirmTitle: `Approve Rev ${item.revNo}?`,
            confirmBody: `It replaces Rev ${item.liveRevNo} for every listener right away. You cannot undo an approval, but the author or council can review a later edit.`,
            confirmLabel: `Approve Rev ${item.revNo}`,
            unavailable: null,
          }}
          onPrimary={props.onApprove}
          reject={{ submitLabel: "Reject edit", hint: "Optional. The author sees it with the rejected edit." }}
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
            <Chip>
              Rev {item.revNo} replaces Rev {item.liveRevNo}
            </Chip>
            <Chip tone={sealed ? "gold" : "warn"}>
              <ReasonIcon aria-hidden className="size-3" stroke={1.5} />
              {reasonLabel(item.pendingReason)}
            </Chip>
          </>
        }
      />
      <div>
        <BlockHead title="Author" />
        {item.author ? (
          <PersonCard
            person={item.author}
            sub={`Submitted Rev ${item.revNo} ${formatElapsed(now - item.createdAt)} ago`}
          />
        ) : (
          <p className="text-[13px] text-unison-text-muted">The author account no longer exists.</p>
        )}
      </div>
      <Callout icon={<ReasonIcon aria-hidden className="mt-0.5 size-4 shrink-0" stroke={1.5} />}>
        <b>Why this needs you.</b> {reasonWhy(item.pendingReason, thresholds)}
      </Callout>
      <div className="grid gap-4 min-[860px]:grid-cols-3">
        <DriftMeter label="Text drift" value={item.textDrift} threshold={thresholds.textDrift} />
        <DriftMeter label="Timing drift" value={item.timingDrift} threshold={thresholds.timingDrift} />
        <DriftMeter label="Jev flag" value={item.jevProbability} threshold={thresholds.jevFlag} />
      </div>
      <div>
        <BlockHead
          title="Changes"
          aside={
            <Segmented
              label="Diff layout"
              value={mode}
              onChange={setMode}
              options={[
                { value: "unified", label: "Unified" },
                { value: "split", label: "Split" },
              ]}
            />
          }
        />
        <Changes item={item} mode={mode} />
      </div>
      <div>
        <BlockHead title="Revision history" />
        <RevisionHistory lyricsId={item.lyricsId} now={now} />
      </div>
    </DetailCard>
  )
}

function DriftMeter({ label, value, threshold }: { label: string; value: number | null; threshold: number }) {
  const over = value !== null && value >= threshold
  return (
    <div className="rounded-[10px] bg-white/[0.02] px-[18px] py-4 shadow-[inset_0_0_0_1px_var(--color-unison-border)]">
      <div className="flex items-baseline justify-between text-xs text-unison-text-muted">
        {label}
        {value === null ? (
          <span className="text-xs">Not scored</span>
        ) : (
          <b className={cn("font-mono text-[15px] font-medium", over ? "text-unison-warn" : "text-unison-text")}>
            {pct(value)}
          </b>
        )}
      </div>
      <div
        className="relative mt-2.5 h-1 rounded-[2px] bg-white/[0.08]"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value === null ? undefined : Math.round(value * 100)}
      >
        {value === null ? null : (
          <i
            className={cn("absolute inset-y-0 left-0 rounded-[2px]", over ? "bg-unison-warn" : "bg-council-edit")}
            style={{ width: `${Math.min(100, value * 100)}%` }}
          />
        )}
        <s
          className="absolute -inset-y-1 w-0.5 rounded-[1px] bg-unison-text-secondary"
          style={{ left: pct(threshold) }}
        />
      </div>
      <div className="mt-2 text-[11px] text-unison-text-muted">Review threshold {pct(threshold)}</div>
    </div>
  )
}

function Changes({ item, mode }: { item: EditItem; mode: DiffMode }) {
  const diff = useRevisionDiff(item.lyricsId, item.revisionId)
  if (diff.isError) return <p className="text-[13px] text-unison-text-muted">Could not load the changes. Try again.</p>
  if (!diff.data) return <Bone className="h-40 w-full rounded-[10px]" />
  return <DiffView rows={diff.data.rows} mode={mode} />
}

const HISTORY_SIZE = 5

function historyLine(rev: RevisionSummary): string {
  const by = rev.author ? ` by ${rev.author.displayName}` : ""
  switch (rev.status) {
    case "pending":
      return `Rev ${rev.revNo} submitted${by}`
    case "live":
      return `Rev ${rev.revNo} is live${by ? `, written${by}` : ""}`
    case "rejected":
      return `Rev ${rev.revNo} was rejected`
    case "withdrawn":
      return `Rev ${rev.revNo} was withdrawn`
    default:
      return `Rev ${rev.revNo}${by}`
  }
}

function RevisionHistory({ lyricsId, now }: { lyricsId: number; now: number }) {
  const revisions = useRevisions(lyricsId).data
  if (!revisions) return null
  return (
    <ul className="pl-1">
      {[...revisions]
        .sort((a, b) => b.revNo - a.revNo)
        .slice(0, HISTORY_SIZE)
        .map((rev) => (
          <li
            key={rev.id}
            className={cn(
              historyItemClass,
              rev.status === "live" && "before:bg-council-edit",
              rev.status === "rejected" && "before:bg-council-reject",
            )}
          >
            {historyLine(rev)}
            <time className="ml-1.5 font-mono text-[11px] text-unison-text-muted">
              {formatElapsed(now - rev.createdAt)}
            </time>
            {rev.reviewNote ? (
              <q className="mt-0.5 block text-xs text-unison-text-muted [quotes:'\201C'_'\201D']">{rev.reviewNote}</q>
            ) : null}
          </li>
        ))}
    </ul>
  )
}
