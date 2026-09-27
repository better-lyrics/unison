import { EmptyState } from "@/components/EmptyState"
import { ListSearch, fieldClass } from "@/components/council/ListSearch"
import { SealDetail } from "@/components/council/SealDetail"
import { Segmented } from "@/components/council/Segmented"
import { NothingSelected, TriageList, TriageListSkeleton, TriageShell } from "@/components/council/TriageList"
import { TriageRow, queueRowParts } from "@/components/council/TriageRow"
import { PageHead } from "@/components/council/headings"
import { useCouncilOverview, useCouncilQueue } from "@/hooks/useCouncilData"
import { useCouncilDecision } from "@/hooks/useCouncilMutations"
import { useTriage } from "@/hooks/useTriage"
import { type QueueFilter, type QueueSort, filterQueue, languageFilters, sortQueue } from "@/lib/council-triage"
import type { QueueItem } from "@/lib/council-types"
import { IconCheck } from "@tabler/icons-react"
import { useState } from "react"
import { useCouncilContext } from "./context"

const entry = (item: QueueItem) => ({ key: String(item.id), itemType: "seal" as const, itemId: item.id })

export function CouncilQueuePage() {
  const { meKeyId } = useCouncilContext()
  const now = Math.floor(Date.now() / 1000)
  const queue = useCouncilQueue().data
  const quota = useCouncilOverview().data?.me.quota ?? null
  const decision = useCouncilDecision()
  const [text, setText] = useState("")
  const [sort, setSort] = useState<QueueSort>("top")
  const [filter, setFilter] = useState<QueueFilter>("all")
  const shown = sortQueue(filterQueue(queue ?? [], { text, filter }), sort)
  const triage = useTriage({ all: queue, shown, entry, meKeyId, now })
  const selected = triage.selectedItem

  const row = (item: QueueItem) => (
    <TriageRow
      key={item.id}
      triage={triage}
      itemKey={entry(item).key}
      item={item}
      {...queueRowParts(item, triage.heldByOther(item), now)}
    />
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
              triage={triage}
              row={row}
              noun={["candidate", "candidates"]}
              tools={
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
                        ...languageFilters(queue).map((language) => ({
                          value: language,
                          label: language.toUpperCase(),
                        })),
                      ]}
                    />
                  </div>
                </>
              }
              empty={
                queue.length === 0 ? (
                  <EmptyState
                    icon={<IconCheck className="size-5" stroke={1.5} />}
                    title="The seal queue is clear"
                    hint="Every candidate has a decision. New lyrics show up here when they reach a positive score with enough votes."
                  />
                ) : null
              }
            />
          ) : (
            <TriageListSkeleton />
          )
        }
        detail={
          selected ? (
            <SealDetail
              item={selected}
              meKeyId={meKeyId}
              now={now}
              quota={quota}
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
          ) : (
            <NothingSelected />
          )
        }
      />
    </>
  )
}
