import { EmptyState } from "@/components/EmptyState"
import { FlagDetail } from "@/components/council/FlagDetail"
import { ListSearch } from "@/components/council/ListSearch"
import { NothingSelected, TriageList, TriageListSkeleton, TriageShell } from "@/components/council/TriageList"
import { TriageRow, flagRowParts } from "@/components/council/TriageRow"
import { PageHead } from "@/components/council/headings"
import { useCouncilFlags } from "@/hooks/useCouncilData"
import { useFlagVote } from "@/hooks/useCouncilMutations"
import { useTriage } from "@/hooks/useTriage"
import { filterFlags } from "@/lib/council-triage"
import type { CouncilFlag } from "@/lib/council-types"
import { IconFlag } from "@tabler/icons-react"
import { useState } from "react"
import { useCouncilContext } from "./context"

const entry = (item: CouncilFlag) => ({ key: String(item.id), itemType: null, itemId: item.id })

export function CouncilFlagsPage() {
  const { meKeyId } = useCouncilContext()
  const now = Math.floor(Date.now() / 1000)
  const payload = useCouncilFlags().data
  const vote = useFlagVote()
  const [text, setText] = useState("")
  const items = payload?.items
  const triage = useTriage({ all: items, shown: filterFlags(items ?? [], text), entry, meKeyId, now })
  const selected = triage.selectedItem

  const row = (item: CouncilFlag) => (
    <TriageRow
      key={item.id}
      triage={triage}
      itemKey={entry(item).key}
      item={item}
      bookmarkable={false}
      {...flagRowParts(item, payload?.needed ?? 0, now)}
    />
  )

  const decide = (item: CouncilFlag, remove: boolean, note: string | null) => {
    triage.afterDecision(entry(item).key)
    vote.mutate({ item, remove, note })
  }

  return (
    <>
      <PageHead
        title="Flags"
        sub="Lyrics hidden after listener reports. Remove them once enough members agree, or keep them to make them visible again."
      />
      <TriageShell
        list={
          payload && items ? (
            <TriageList
              label="Open flags"
              triage={triage}
              row={row}
              noun={["flag", "flags"]}
              openAside="Oldest first"
              tools={<ListSearch ref={triage.searchRef} value={text} onChange={setText} placeholder="Filter flags" />}
              empty={
                items.length === 0 ? (
                  <EmptyState
                    icon={<IconFlag className="size-5" stroke={1.5} />}
                    title="No open flags"
                    hint="Lyrics land here when listener reports hide them."
                  />
                ) : null
              }
            />
          ) : (
            <TriageListSkeleton />
          )
        }
        detail={
          selected && payload ? (
            <FlagDetail
              item={selected}
              needed={payload.needed}
              now={now}
              meKeyId={meKeyId}
              onRemove={() => decide(selected, true, null)}
              onKeep={(note) => decide(selected, false, note)}
              busy={vote.isPending}
            />
          ) : (
            <NothingSelected />
          )
        }
      />
    </>
  )
}
