import { EmptyState } from "@/components/EmptyState"
import { EditDetail } from "@/components/council/EditDetail"
import { ListSearch } from "@/components/council/ListSearch"
import { NothingSelected, TriageList, TriageListSkeleton, TriageShell } from "@/components/council/TriageList"
import { TriageRow, editRowParts } from "@/components/council/TriageRow"
import { PageHead } from "@/components/council/headings"
import { useCouncilEdits } from "@/hooks/useCouncilData"
import { useCouncilDecision } from "@/hooks/useCouncilMutations"
import { useTriage } from "@/hooks/useTriage"
import { filterEdits } from "@/lib/council-triage"
import type { EditItem } from "@/lib/council-types"
import { IconCheck } from "@tabler/icons-react"
import { useState } from "react"
import { useCouncilContext } from "./context"

const entry = (item: EditItem) => ({ key: String(item.revisionId), itemType: "edit" as const, itemId: item.revisionId })

export function CouncilEditsPage() {
  const { meKeyId } = useCouncilContext()
  const now = Math.floor(Date.now() / 1000)
  const payload = useCouncilEdits().data
  const decision = useCouncilDecision()
  const [text, setText] = useState("")
  const edits = payload?.items
  const triage = useTriage({ all: edits, shown: filterEdits(edits ?? [], text), entry, meKeyId, now })
  const selected = triage.selectedItem

  const row = (item: EditItem) => (
    <TriageRow
      key={item.revisionId}
      triage={triage}
      itemKey={entry(item).key}
      item={item}
      {...editRowParts(item, triage.heldByOther(item), now)}
    />
  )

  return (
    <>
      <PageHead
        title="Edits"
        sub="Owner edits held for council review. Approving makes the new revision live for everyone."
      />
      <TriageShell
        list={
          payload && edits ? (
            <TriageList
              label="Open edits"
              triage={triage}
              row={row}
              noun={["edit", "edits"]}
              openAside="Oldest first"
              tools={<ListSearch ref={triage.searchRef} value={text} onChange={setText} placeholder="Filter edits" />}
              empty={
                edits.length === 0 ? (
                  <EmptyState
                    icon={<IconCheck className="size-5" stroke={1.5} />}
                    title="No edits waiting"
                    hint="Owner edits that need council review show up here."
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
            <EditDetail
              item={selected}
              thresholds={payload.thresholds}
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
          ) : (
            <NothingSelected />
          )
        }
      />
    </>
  )
}
