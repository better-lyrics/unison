import { buttonClass } from "@/components/ui"
import { useCouncilMetadata, useCouncilRole } from "@/hooks/useCouncilData"
import { useProposeMetadata } from "@/hooks/useCouncilMutations"
import type { SongMetadata } from "@/lib/council-types"
import { plural } from "@/lib/format"
import { pushToast } from "@/lib/toast"
import { IconTags } from "@tabler/icons-react"
import { useId, useState } from "react"
import { Link } from "react-router-dom"
import { CouncilOverlay } from "./CouncilOverlay"

const inputClass =
  "w-full rounded-md border border-unison-border bg-unison-bg px-3 py-2 text-sm text-unison-text focus:border-unison-border-strong focus:outline-none disabled:opacity-60"
const labelClass = "text-[10px] uppercase tracking-wider text-unison-text-muted"

export function EditMetadataButton({
  videoId,
  lyricsId,
  current,
}: {
  videoId: string
  lyricsId: number
  current: SongMetadata
}) {
  const role = useCouncilRole()
  const metadata = useCouncilMetadata().data
  const [open, setOpen] = useState(false)
  if (role === null || !metadata) return null

  const openProposal = metadata.items.find((item) => item.videoId === videoId)
  if (openProposal) {
    return (
      <Link to={`/council/metadata?item=${openProposal.id}`} className={buttonClass("ghost", "sm")}>
        <IconTags aria-hidden className="size-3.5" stroke={1.75} />
        Details proposal open
      </Link>
    )
  }

  return (
    <>
      <button type="button" className={buttonClass("fill", "sm")} onClick={() => setOpen(true)}>
        <IconTags aria-hidden className="size-3.5" stroke={1.75} />
        Edit details
      </button>
      {open ? (
        <MetadataDialog
          videoId={videoId}
          lyricsId={lyricsId}
          current={current}
          needed={metadata.needed}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}

function MetadataDialog({
  videoId,
  lyricsId,
  current,
  needed,
  onClose,
}: {
  videoId: string
  lyricsId: number
  current: SongMetadata
  needed: number
  onClose: () => void
}) {
  const id = useId()
  const propose = useProposeMetadata()
  const [song, setSong] = useState(current.song)
  const [artist, setArtist] = useState(current.artist)
  const [album, setAlbum] = useState(current.album ?? "")
  const next = { song: song.trim(), artist: artist.trim(), album: album.trim() || null }
  const unchanged = next.song === current.song && next.artist === current.artist && next.album === current.album
  const disabled = unchanged || next.song === "" || next.artist === "" || propose.isPending
  const more = needed - 1

  const submit = () =>
    propose.mutate(
      { videoId, lyricsId, ...next },
      {
        onSuccess: () => {
          pushToast({
            kind: "info",
            message: `Proposed new details. ${plural(more, "more approval", "more approvals")} needed.`,
          })
          onClose()
        },
      },
    )

  const fields: [string, string, (value: string) => void][] = [
    ["Title", song, setSong],
    ["Artist", artist, setArtist],
    ["Album", album, setAlbum],
  ]

  return (
    <CouncilOverlay
      open
      onOpenChange={(value) => (value ? null : onClose())}
      label="Edit song details"
      className="top-1/2 -translate-y-1/2 px-[22px] py-5"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!disabled) submit()
        }}
      >
        <h2 className="text-base font-semibold">Edit song details</h2>
        {fields.map(([label, value, onChange]) => (
          <div key={label} className="space-y-1">
            <label htmlFor={`${id}-${label}`} className={labelClass}>
              {label}
            </label>
            <input
              id={`${id}-${label}`}
              type="text"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              disabled={propose.isPending}
              autoComplete="off"
              spellCheck={false}
              className={inputClass}
            />
          </div>
        ))}
        <p className="text-xs text-unison-text-muted">
          {needed} council members must approve. Changes apply to every version of this song.
        </p>
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={buttonClass("ghost", "sm")} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={disabled} className={buttonClass("primary", "sm")}>
            Propose
          </button>
        </div>
      </form>
    </CouncilOverlay>
  )
}
