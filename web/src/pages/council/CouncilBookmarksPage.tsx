import { EmptyState } from "@/components/EmptyState"
import { EditDetail } from "@/components/council/EditDetail"
import { SealDetail } from "@/components/council/SealDetail"
import { NothingSelected, TriageList, TriageListSkeleton, TriageShell } from "@/components/council/TriageList"
import { TriageRow, editRowParts, queueRowParts } from "@/components/council/TriageRow"
import { PageHead } from "@/components/council/headings"
import { useCouncilEdits, useCouncilOverview, useCouncilQueue } from "@/hooks/useCouncilData"
import { useCouncilDecision } from "@/hooks/useCouncilMutations"
import { useTriage } from "@/hooks/useTriage"
import { groupByBookmark } from "@/lib/council-triage"
import type { EditItem, QueueItem } from "@/lib/council-types"
import { plural } from "@/lib/format"
import { IconBookmark } from "@tabler/icons-react"
import { useCouncilContext } from "./context"

type Held = QueueItem | EditItem

const isEdit = (item: Held): item is EditItem => "revisionId" in item

const entry = (item: Held) =>
  isEdit(item)
    ? { key: `edit:${item.revisionId}`, itemType: "edit" as const, itemId: item.revisionId }
    : { key: `seal:${item.id}`, itemType: "seal" as const, itemId: item.id }

const DAY = 86400

export function CouncilBookmarksPage() {
  const { meKeyId } = useCouncilContext()
  const now = Math.floor(Date.now() / 1000)
  const queue = useCouncilQueue().data
  const edits = useCouncilEdits().data
  const overview = useCouncilOverview().data
  const decision = useCouncilDecision()
  const all = queue && edits ? [...queue, ...edits.items] : undefined
  const mine = all
    ? groupByBookmark<Held>(all, meKeyId, now).mine.sort(
        (a, b) => (a.bookmark?.expiresAt ?? 0) - (b.bookmark?.expiresAt ?? 0),
      )
    : []
  const triage = useTriage<Held>({ all: all ? mine : undefined, shown: mine, entry, meKeyId, now })
  const selected = triage.selectedItem
  const hold = overview ? plural(Math.round(overview.me.bookmarkTtlSec / DAY), "day", "days") : "a few days"

  const row = (item: Held) => (
    <TriageRow
      key={entry(item).key}
      triage={triage}
      itemKey={entry(item).key}
      item={item}
      {...(isEdit(item) ? editRowParts(item, false, now) : queueRowParts(item, false, now))}
    />
  )

  let detail = <NothingSelected />
  if (selected && isEdit(selected) && edits) {
    detail = (
      <EditDetail
        item={selected}
        thresholds={edits.thresholds}
        now={now}
        bookmark={triage.bookmarkState(selected)}
        bookmarkPending={triage.bookmarkPending}
        onBookmark={() => triage.toggleBookmark(selected)}
        onApprove={() => {
          triage.afterDecision(entry(selected).key)
          decision.mutate({ kind: "approve-edit", item: selected })
        }}
        onReject={(note) => {
          triage.afterDecision(entry(selected).key)
          decision.mutate({ kind: "reject-edit", item: selected, note })
        }}
        busy={decision.isPending}
      />
    )
  } else if (selected && !isEdit(selected)) {
    detail = (
      <SealDetail
        item={selected}
        meKeyId={meKeyId}
        now={now}
        quota={overview?.me.quota ?? null}
        bookmark={triage.bookmarkState(selected)}
        bookmarkPending={triage.bookmarkPending}
        onBookmark={() => triage.toggleBookmark(selected)}
        onSeal={() => {
          triage.afterDecision(entry(selected).key)
          decision.mutate({ kind: "seal", item: selected })
        }}
        onReject={(note) => {
          triage.afterDecision(entry(selected).key)
          decision.mutate({ kind: "reject", item: selected, note })
        }}
        busy={decision.isPending}
      />
    )
  }

  return (
    <>
      <PageHead
        title="Bookmarks"
        sub={`Items you are holding. Each goes back to the open queue ${hold} after you bookmark it.${
          overview ? ` You can hold ${overview.me.bookmarkCap} at a time.` : ""
        }`}
      />
      <TriageShell
        list={
          all ? (
            <TriageList
              flat
              label="Your bookmarks"
              triage={triage}
              row={row}
              noun={["bookmark", "bookmarks"]}
              empty={
                mine.length === 0 ? (
                  <EmptyState
                    icon={<IconBookmark className="size-5" stroke={1.5} />}
                    title="No bookmarks"
                    hint={`Press B on any queue item to hold it for ${hold}. Other members skip it while it is bookmarked.`}
                  />
                ) : null
              }
            />
          ) : (
            <TriageListSkeleton />
          )
        }
        detail={mine.length === 0 && all ? null : detail}
      />
    </>
  )
}
