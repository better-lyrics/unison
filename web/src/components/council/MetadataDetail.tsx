import { useCouncilShortcuts } from "@/hooks/useCouncilShortcuts"
import { changedFields, metadataValue } from "@/lib/council-metadata"
import type { MetadataItem } from "@/lib/council-types"
import { formatElapsed } from "@/lib/format"
import { youTubeMusicUrl } from "@/lib/youtube-music"
import { IconCheck } from "@tabler/icons-react"
import { ActionBar } from "./ActionBar"
import { BlockHead, Chip, DetailCard, DetailHeader, PersonCard } from "./detail-parts"

interface MetadataDetailProps {
  item: MetadataItem
  needed: number
  now: number
  meKeyId: string
  onApprove: () => void
  onReject: (note: string | null) => void
  busy: boolean
}

export function MetadataDetail({ item, needed, now, meKeyId, onApprove, onReject, busy }: MetadataDetailProps) {
  useCouncilShortcuts({
    o: () => {
      window.open(youTubeMusicUrl(item.videoId), "_blank", "noreferrer")
    },
  })
  const approved = item.approvers.some((p) => p.keyId === meKeyId)

  return (
    <DetailCard
      actions={
        <ActionBar
          key={item.id}
          primary={{
            label: "Approve",
            icon: IconCheck,
            shortcut: "A",
            confirmTitle: "Approve these details?",
            confirmBody: `They go live on every version of this song once ${needed} members approve.`,
            confirmLabel: "Approve details",
            unavailable: approved ? "You approved" : null,
          }}
          onPrimary={onApprove}
          reject={{ submitLabel: "Reject details", hint: "One reject closes the proposal." }}
          onReject={onReject}
          busy={busy}
        />
      }
    >
      <DetailHeader
        videoId={item.videoId}
        title={item.song}
        artist={item.artist}
        chips={
          <Chip>
            {item.approvers.length} of {needed} approvals
          </Chip>
        }
      />
      <div>
        <BlockHead title="Changes" />
        <table aria-label="Proposed changes" className="w-full text-[13px]">
          <tbody>
            {changedFields(item).map((field) => {
              const { before, proposed } = metadataValue(item, field)
              return (
                <tr key={field} className="align-baseline">
                  <th scope="row" className="w-20 py-1.5 pr-4 text-left text-xs font-normal text-unison-text-muted">
                    {field}
                  </th>
                  <td className="py-1.5 pr-4 text-unison-text-muted line-through">{before ?? "None"}</td>
                  <td className="py-1.5 font-medium">{proposed ?? "None"}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div>
        <BlockHead title="Proposed by" />
        {item.proposer ? (
          <PersonCard person={item.proposer} sub={`Proposed ${formatElapsed(now - item.createdAt)} ago`} />
        ) : (
          <p className="text-[13px] text-unison-text-muted">The proposer account no longer exists.</p>
        )}
      </div>
      <div>
        <BlockHead title="Approved by" />
        <div className="flex flex-col gap-3">
          {item.approvers.map((person) => (
            <PersonCard key={person.keyId} person={person} sub={person.keyId === meKeyId ? "You" : "Approved"} />
          ))}
        </div>
      </div>
    </DetailCard>
  )
}
