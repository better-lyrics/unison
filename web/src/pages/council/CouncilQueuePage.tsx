import { EmptyState } from "@/components/EmptyState"
import type { BookmarkState } from "@/components/council/ActionBar"
import { ListSearch, fieldClass } from "@/components/council/ListSearch"
import { SealDetail } from "@/components/council/SealDetail"
import { Segmented } from "@/components/council/Segmented"
import { TriageList, TriageShell } from "@/components/council/TriageList"
import { BookmarkToggle, TriageRow, queueRowParts } from "@/components/council/TriageRow"
import { PageHead } from "@/components/council/headings"
import { Bone, skeletonKeys } from "@/components/skeleton"
import { useCouncilEdits, useCouncilOverview, useCouncilQueue } from "@/hooks/useCouncilData"
import { type Decision, useCouncilDecision } from "@/hooks/useCouncilMutations"
import { useStoredState } from "@/hooks/useStoredState"
import { useTriage } from "@/hooks/useTriage"
import { type QueueFilter, type QueueSort, filterQueue, languageFilters, sortQueue } from "@/lib/council-triage"
import type { QueueItem } from "@/lib/council-types"
import { IconCheck, IconPointer } from "@tabler/icons-react"
import { useState } from "react"
import { useCouncilContext } from "./context"

const entry = (item: QueueItem) => ({ key: String(item.id), itemType: "seal" as const, itemId: item.id })

export function CouncilQueuePage() {
  const { meKeyId } = useCouncilContext()
  const now = Math.floor(Date.now() / 1000)
  const queue = useCouncilQueue().data
  const overview = useCouncilOverview().data
  const edits = useCouncilEdits().data?.items
  const cap = overview?.me.bookmarkCap ?? null
  const decision = useCouncilDecision()
  const [text, setText] = useState("")
  const [sort, setSort] = useState<QueueSort>("top")
  const [filter, setFilter] = useState<QueueFilter>("all")
  const [autoAdvance, setAutoAdvance] = useStoredState<"on" | "off">("council.autoAdvance", "on")
  const shown = sortQueue(filterQueue(queue ?? [], { text, filter }), sort)
  const triage = useTriage({ all: queue, shown, entry, meKeyId, now })

  const decide = (d: Extract<Decision, { item: QueueItem }>) => {
    const key = String(d.item.id)
    triage.select(autoAdvance === "on" ? triage.nextAfter(key) : null)
    decision.mutate(d)
  }

  const myBookmarks = [...(queue ?? []), ...(edits ?? [])].filter(
    (i) => i.bookmark !== null && i.bookmark.expiresAt > now && i.bookmark.holder.keyId === meKeyId,
  ).length

  const bookmarkState = (item: QueueItem): BookmarkState => {
    if (triage.heldByOther(item) && item.bookmark) return { kind: "other", holder: item.bookmark.holder.displayName }
    if (item.bookmark && item.bookmark.expiresAt > now) return { kind: "mine" }
    return { kind: "open", capped: cap !== null && myBookmarks >= cap, cap: cap ?? 0 }
  }

  const row = (item: QueueItem) => {
    const key = entry(item).key
    const heldByOther = triage.heldByOther(item)
    const parts = queueRowParts(item, heldByOther, now)
    return (
      <TriageRow
        key={key}
        itemKey={key}
        href={triage.hrefFor(key)}
        selected={triage.selectedKey === key}
        videoId={item.videoId}
        heldByOther={heldByOther}
        toggle={
          heldByOther ? null : (
            <BookmarkToggle
              on={item.bookmark !== null}
              song={item.song}
              disabled={triage.bookmarkPending}
              onToggle={() => triage.toggleBookmark(item)}
            />
          )
        }
        {...parts}
      />
    )
  }

  const tools = (
    <>
      <div className="flex items-center gap-2">
        <ListSearch
          ref={triage.searchRef}
          value={text}
          onChange={setText}
          placeholder="Filter by song, artist, submitter"
        />
        <select
          aria-label="Sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as QueueSort)}
          className={fieldClass}
        >
          <option value="top">Top rated</option>
          <option value="votes">Most voted</option>
          <option value="waiting">Longest waiting</option>
        </select>
      </div>
      <div>
        <Segmented
          label="Filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "flags", label: "Has flags" },
            ...languageFilters(queue ?? []).map((language) => ({ value: language, label: language.toUpperCase() })),
          ]}
        />
      </div>
    </>
  )

  return (
    <>
      <PageHead
        title="Seal queue"
        sub="Top-ranked variant per song with a positive score, not yet sealed or rejected. Seals are for the exceptional."
      />
      <TriageShell
        list={
          queue ? (
            <TriageList
              label="Open candidates"
              tools={tools}
              mine={triage.mine.map(row)}
              open={triage.open.map(row)}
              others={triage.others.map(row)}
              cap={cap}
              othersOpen={triage.othersOpen}
              onToggleOthers={() => triage.setOthersOpen(!triage.othersOpen)}
              fresh={{ count: triage.fresh.length, noun: ["candidate", "candidates"], onShow: triage.revealFresh }}
              empty={
                queue.length === 0 ? (
                  <EmptyState
                    icon={<IconCheck className="size-5" stroke={1.5} />}
                    title="The seal queue is clear"
                    hint="Every candidate has a decision. New lyrics show up here when they reach a positive score with enough votes."
                  />
                ) : null
              }
              autoAdvance={autoAdvance === "on"}
              onAutoAdvance={(on) => setAutoAdvance(on ? "on" : "off")}
            />
          ) : (
            <ListSkeleton />
          )
        }
        detail={
          triage.selectedItem ? (
            <SealDetail
              item={triage.selectedItem}
              meKeyId={meKeyId}
              now={now}
              quota={overview?.me.quota ?? null}
              bookmark={bookmarkState(triage.selectedItem)}
              bookmarkPending={triage.bookmarkPending}
              onBookmark={() => triage.selectedItem && triage.toggleBookmark(triage.selectedItem)}
              onSeal={() => triage.selectedItem && decide({ kind: "seal", item: triage.selectedItem })}
              onReject={(note) => triage.selectedItem && decide({ kind: "reject", item: triage.selectedItem, note })}
              busy={decision.isPending}
            />
          ) : (
            <EmptyState
              icon={<IconPointer className="size-5" stroke={1.5} />}
              title="Nothing selected"
              hint="Pick an item from the list, or press J to start at the top."
            />
          )
        }
      />
    </>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1.5">
      <Bone className="mb-4 h-8 w-full" />
      {skeletonKeys("row", 6).map((key) => (
        <Bone key={key} className="h-[70px] w-full rounded-[10px]" />
      ))}
    </div>
  )
}
