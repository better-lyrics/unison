import { EmptyState } from "@/components/EmptyState"
import { ListSearch, fieldClass } from "@/components/council/ListSearch"
import { SealDetail } from "@/components/council/SealDetail"
import { ToggleSegments } from "@/components/council/Segmented"
import { NothingSelected, TriageList, TriageListSkeleton, TriageShell } from "@/components/council/TriageList"
import { TriageRow, queueRowParts } from "@/components/council/TriageRow"
import { PageHead } from "@/components/council/headings"
import { useCouncilOverview, useCouncilQueue, useSealableVariants } from "@/hooks/useCouncilData"
import { useCouncilDecision } from "@/hooks/useCouncilMutations"
import { useTriage } from "@/hooks/useTriage"
import {
  type FlagFilter,
  NO_FILTERS,
  type QueueFilters,
  type QueueSort,
  filterQueue,
  languageFilters,
  sortQueue,
} from "@/lib/council-triage"
import type { QueueItem } from "@/lib/council-types"
import { videoIdFromInput } from "@/lib/youtube-music"
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
  const [filters, setFilters] = useState<QueueFilters>(NO_FILTERS)
  const linkedVideo = videoIdFromInput(text)
  const sealable = useSealableVariants(linkedVideo).data
  const queued = new Set(queue?.map((item) => item.id))
  const linked = new Set(linkedVideo ? sealable?.map((item) => item.id) : [])
  const outside = linkedVideo && queue ? (sealable ?? []).filter((item) => !queued.has(item.id)) : []
  const matched = filterQueue(queue ?? [], { text, ...filters })
  const linkedInQueue = filterQueue(
    (queue ?? []).filter((item) => linked.has(item.id) && !matched.includes(item)),
    { text: "", ...filters },
  )
  const shown = sortQueue([...matched, ...linkedInQueue], sort)
  const extra = filterQueue(outside, { text: "", ...filters })
  const triage = useTriage({ all: queue, shown, extra, entry, meKeyId, now })
  const selected = triage.selectedItem

  const flagOption = (flags: FlagFilter, label: string) => ({
    key: flags,
    label,
    pressed: filters.flags === flags,
    onToggle: () => setFilters((f) => ({ ...f, flags: f.flags === flags ? "any" : flags })),
  })
  const toggleLanguage = (language: string) =>
    setFilters((f) => ({
      ...f,
      languages: f.languages.includes(language)
        ? f.languages.filter((l) => l !== language)
        : [...f.languages, language],
    }))

  const row = (item: QueueItem) => (
    <TriageRow
      key={item.id}
      triage={triage}
      itemKey={entry(item).key}
      item={item}
      {...queueRowParts(item, triage.heldByOther(item), now, !queued.has(item.id))}
    />
  )

  return (
    <>
      <PageHead
        title="Seal queue"
        sub="The best-rated lyric for each song that nobody has sealed or rejected yet. Paste a song link to find one that is not listed."
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
                      className="flex-1"
                      value={text}
                      onChange={setText}
                      placeholder="Filter, or paste a song link"
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
                    <ToggleSegments
                      label="Filter"
                      options={[
                        {
                          key: "all",
                          label: "All",
                          pressed: filters.flags === "any" && filters.languages.length === 0,
                          onToggle: () => setFilters(NO_FILTERS),
                        },
                        flagOption("flagged", "Has flags"),
                        flagOption("clean", "No flags"),
                        ...languageFilters(queue).map((language) => ({
                          key: language,
                          label: language.toUpperCase(),
                          pressed: filters.languages.includes(language),
                          onToggle: () => toggleLanguage(language),
                        })),
                      ]}
                    />
                  </div>
                </>
              }
              noMatch={
                linkedVideo && sealable
                  ? "Nothing to seal for this song. Its lyrics are already sealed, rejected, hidden or not rated well enough yet."
                  : undefined
              }
              empty={
                queue.length === 0 && !linkedVideo ? (
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
