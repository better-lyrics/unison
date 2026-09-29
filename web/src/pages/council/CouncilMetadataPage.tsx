import { EmptyState } from "@/components/EmptyState"
import { ListSearch } from "@/components/council/ListSearch"
import { MetadataDetail } from "@/components/council/MetadataDetail"
import { NothingSelected, TriageList, TriageListSkeleton, TriageShell } from "@/components/council/TriageList"
import { TriageRow, metadataRowParts } from "@/components/council/TriageRow"
import { PageHead } from "@/components/council/headings"
import { useCouncilMetadata } from "@/hooks/useCouncilData"
import { useMetadataVote } from "@/hooks/useCouncilMutations"
import { useTriage } from "@/hooks/useTriage"
import { filterMetadata } from "@/lib/council-triage"
import type { MetadataItem } from "@/lib/council-types"
import { IconTags } from "@tabler/icons-react"
import { useState } from "react"
import { useCouncilContext } from "./context"

const entry = (item: MetadataItem) => ({ key: String(item.id), itemType: null, itemId: item.id })

export function CouncilMetadataPage() {
  const { meKeyId } = useCouncilContext()
  const now = Math.floor(Date.now() / 1000)
  const payload = useCouncilMetadata().data
  const vote = useMetadataVote()
  const [text, setText] = useState("")
  const items = payload?.items
  const triage = useTriage({ all: items, shown: filterMetadata(items ?? [], text), entry, meKeyId, now })
  const selected = triage.selectedItem

  const row = (item: MetadataItem) => (
    <TriageRow
      key={item.id}
      triage={triage}
      itemKey={entry(item).key}
      item={item}
      bookmarkable={false}
      {...metadataRowParts(item, payload?.needed ?? 0, now)}
    />
  )

  const decide = (item: MetadataItem, approve: boolean, note: string | null) => {
    triage.afterDecision(entry(item).key)
    vote.mutate({ item, approve, note })
  }

  return (
    <>
      <PageHead
        title="Details"
        sub="Proposed title, artist and album changes. They apply to every version of the song once enough members approve."
      />
      <TriageShell
        list={
          payload && items ? (
            <TriageList
              label="Open proposals"
              triage={triage}
              row={row}
              noun={["proposal", "proposals"]}
              openAside="Oldest first"
              tools={
                <ListSearch ref={triage.searchRef} value={text} onChange={setText} placeholder="Filter proposals" />
              }
              empty={
                items.length === 0 ? (
                  <EmptyState
                    icon={<IconTags className="size-5" stroke={1.5} />}
                    title="No open proposals"
                    hint="Propose new details from any song page."
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
            <MetadataDetail
              item={selected}
              needed={payload.needed}
              now={now}
              meKeyId={meKeyId}
              onApprove={() => decide(selected, true, null)}
              onReject={(note) => decide(selected, false, note)}
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
