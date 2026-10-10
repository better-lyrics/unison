import { useCouncilShortcuts } from "@/hooks/useCouncilShortcuts"
import { flagConflict, reportGroups } from "@/lib/council-flags"
import type { CouncilFlag, CouncilPerson, FlagReport } from "@/lib/council-types"
import { formatElapsed, plural } from "@/lib/format"
import { youTubeMusicUrl } from "@/lib/youtube-music"
import { IconTrash } from "@tabler/icons-react"
import { ActionBar } from "./ActionBar"
import { LyricPreview } from "./LyricPreview"
import { BlockHead, Chip, DetailCard, DetailHeader, PersonCard } from "./detail-parts"

interface FlagDetailProps {
  item: CouncilFlag
  needed: number
  now: number
  meKeyId: string
  onRemove: () => void
  onKeep: (note: string | null) => void
  busy: boolean
}

export function FlagDetail({ item, needed, now, meKeyId, onRemove, onKeep, busy }: FlagDetailProps) {
  useCouncilShortcuts({
    o: () => {
      window.open(youTubeMusicUrl(item.videoId), "_blank", "noreferrer")
    },
  })
  const conflict = flagConflict(item, meKeyId)
  const removed = item.removers.some((p) => p.keyId === meKeyId)

  return (
    <DetailCard
      actions={
        <ActionBar
          key={item.id}
          primary={{
            label: "Remove",
            icon: IconTrash,
            shortcut: "A",
            confirmTitle: "Remove this lyric?",
            confirmBody: "Removing deletes this lyric and penalises its submitter once the quorum is reached.",
            confirmLabel: "Remove",
            unavailable: conflict ?? (removed ? "You voted to remove" : null),
          }}
          onPrimary={onRemove}
          reject={{
            label: "Keep",
            submitLabel: "Keep",
            hint: "Keeping makes the lyric visible again and closes the flag.",
            unavailable: conflict !== null,
            noteLabel: "Why keep it? (optional)",
            placeholder: "For example: these are real lyrics, the reports are wrong",
          }}
          onReject={onKeep}
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
            Remove {item.removers.length} of {needed}
          </Chip>
        }
      />
      <div>
        <BlockHead title="Submitter" />
        {item.submitter ? (
          <PersonCard person={item.submitter} sub={`Flag opened ${formatElapsed(now - item.openedAt)} ago`} />
        ) : (
          <p className="text-[13px] text-unison-text-muted">The submitter account no longer exists.</p>
        )}
      </div>
      <div>
        <BlockHead title="Reports" aside={plural(item.reports.length, "report", "reports")} />
        <div className="flex flex-col gap-5">
          {reportGroups(item.reports).map((group) => (
            <div key={group.reason} className="flex flex-col gap-3">
              <div>
                <Chip>
                  <span>{group.label}</span>
                  <span className="font-mono">{group.reports.length}</span>
                </Chip>
              </div>
              {group.reports.map((report) => (
                <ReportEntry key={`${report.createdAt}-${report.reporter?.keyId}`} report={report} now={now} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <Voters title="Voted to remove" people={item.removers} meKeyId={meKeyId} />
      <Voters title="Voted to keep" people={item.keepers} meKeyId={meKeyId} />
      <LyricPreview key={item.id} lyricId={item.lyricsId} videoId={item.videoId} />
    </DetailCard>
  )
}

function ReportEntry({ report, now }: { report: FlagReport; now: number }) {
  const when = `Reported ${formatElapsed(now - report.createdAt)} ago`
  const sub = report.details ? `${report.details} · ${when}` : when
  if (!report.reporter) {
    return <p className="text-[13px] text-unison-text-muted">The reporter account no longer exists. {sub}</p>
  }
  return <PersonCard person={report.reporter} sub={sub} />
}

function Voters({ title, people, meKeyId }: { title: string; people: CouncilPerson[]; meKeyId: string }) {
  if (people.length === 0) return null
  return (
    <div>
      <BlockHead title={title} />
      <div className="flex flex-col gap-3">
        {people.map((person) => (
          <PersonCard key={person.keyId} person={person} sub={person.keyId === meKeyId ? "You" : "Council member"} />
        ))}
      </div>
    </div>
  )
}
