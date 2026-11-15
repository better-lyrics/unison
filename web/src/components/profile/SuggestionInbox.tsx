import { SongThumbnail } from "@/components/SongThumbnail"
import { SectionHeading } from "@/components/profile/SectionHeading"
import {
  SuggestionAuthor,
  SuggestionChangesDialog,
  authorName,
  suggestionPreviewPath,
} from "@/components/song/SuggestionChanges"
import { buttonClass, panelClass, sentenceCaseTagClass, tagClass } from "@/components/ui"
import { useMySuggestions } from "@/hooks/useLyricsData"
import { usePresence } from "@/hooks/usePresence"
import { type SuggestionViewer, useSuggestionViewer } from "@/hooks/useSuggestionViewer"
import { cn } from "@/lib/cn"
import { reasonLabel } from "@/lib/council-reasons"
import { formatElapsed, formatRemaining } from "@/lib/format"
import { type SuggestionContent, previewActions, suggestionDecider } from "@/lib/lyric-suggestion"
import type { SuggestionInboxItem } from "@/lib/revision-types"
import { IconAlertTriangle, IconArrowsDiff } from "@tabler/icons-react"
import { useState } from "react"
import { Link } from "react-router-dom"

const ownerActions = (viewer: SuggestionViewer | null, item: SuggestionInboxItem, content: SuggestionContent) =>
  previewActions(viewer, { submitterKeyId: viewer?.keyId ?? null, suggestion: item.suggestion, content })

export function SuggestionInbox() {
  const items = useMySuggestions(true).data
  const viewer = useSuggestionViewer()
  if (!items || items.length === 0) return null
  return <SuggestionInboxView items={items} viewer={viewer} now={Math.floor(Date.now() / 1000)} />
}

export function SuggestionInboxView({
  items,
  viewer,
  now,
}: {
  items: SuggestionInboxItem[]
  viewer: SuggestionViewer | null
  now: number
}) {
  const [openId, setOpenId] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  const dialog = usePresence(open, "--modal-close-dur")
  const shown = items.find((item) => item.suggestion.id === openId)

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading title="Suggestions on your lyrics" meta={`${items.length} waiting`} />
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <InboxRow
            key={item.suggestion.id}
            item={item}
            councilDecides={suggestionDecider(item.suggestion) === "council"}
            now={now}
            onSeeChanges={() => {
              setOpenId(item.suggestion.id)
              setOpen(true)
            }}
          />
        ))}
      </ul>
      {dialog.mounted && shown ? (
        <SuggestionChangesDialog
          open={open}
          item={shown}
          actionsFor={(content) => ownerActions(viewer, shown, content)}
          now={now}
          previewPath={suggestionPreviewPath(shown, shown.suggestion.id)}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  )
}

function InboxRow({
  item,
  councilDecides,
  now,
  onSeeChanges,
}: {
  item: SuggestionInboxItem
  councilDecides: boolean
  now: number
  onSeeChanges: () => void
}) {
  const { suggestion } = item
  const opensAt = suggestion.councilDecidesAt
  return (
    <li className="relative">
      <Link
        to={suggestionPreviewPath(item, suggestion.id)}
        className={cn(
          panelClass,
          "flex items-center gap-3 rounded-[10px] py-3 pr-[148px] pl-3.5 transition-colors duration-150 hover:bg-unison-bg-hover max-sm:pr-3.5",
        )}
      >
        <SongThumbnail videoId={item.videoId} song={item.song} artist={item.artist} className="size-11 rounded-md" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm leading-tight font-medium">{item.song}</span>
          <span className="mt-px flex min-w-0 items-center gap-1.5 text-xs leading-tight text-unison-text-secondary">
            <span className="truncate">{`${item.artist} · suggested by`}</span>
            <SuggestionAuthor suggestion={suggestion} className="size-4" />
            <span className="truncate">{authorName(suggestion, "mid")}</span>
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-unison-text-muted">
            <span className={cn(tagClass, sentenceCaseTagClass)}>{`Rev ${suggestion.revNo}`}</span>
            {suggestion.pendingReason === "suggested" ? null : (
              <span className="inline-flex items-center gap-[3px] text-[#f7c46c]">
                <IconAlertTriangle aria-hidden className="size-3" stroke={1.75} />
                {reasonLabel(suggestion.pendingReason)}
              </span>
            )}
            <span>{`${formatElapsed(now - suggestion.createdAt)} ago`}</span>
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 max-sm:hidden">
          <span
            className={cn(
              "text-xs font-medium",
              councilDecides ? "text-unison-text-secondary" : "text-council-edit-ink",
            )}
          >
            {councilDecides ? "Council decides" : "You decide"}
          </span>
          <span
            className={cn(
              "text-[11px] text-unison-text-muted tabular-nums",
              !councilDecides && opensAt !== null && "font-mono",
            )}
          >
            {councilDecides
              ? "You can still reject it"
              : opensAt === null
                ? "The council can decide too"
                : `${formatRemaining(opensAt - now)} left`}
          </span>
        </span>
      </Link>
      <div className="absolute top-1/2 right-3.5 -translate-y-1/2 max-sm:hidden">
        <button type="button" className={buttonClass("ghost", "sm")} onClick={onSeeChanges}>
          <IconArrowsDiff aria-hidden className="size-3.5" stroke={1.75} />
          See changes
        </button>
      </div>
    </li>
  )
}
