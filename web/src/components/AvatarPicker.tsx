import { IconBrandDiscordFilled, IconLoader2 } from "@tabler/icons-react"
import { useCallback, useState } from "react"
import { useSession } from "@/auth/useSession"
import { secondaryButtonClass } from "@/components/discord-ui"
import { Tooltip } from "@/components/Tooltip"
import { editableCardClass } from "@/components/ui"
import { useAsyncData } from "@/hooks/useAsyncData"
import type { DiscordLink } from "@/hooks/useDiscordLink"
import { fetchAvatarCatalogue, fetchUserSubmissions, putAvatar } from "@/lib/api"
import { useArtwork } from "@/lib/artwork"
import { dicebearThumbsDataUri } from "@/lib/avatar"
import type { AvatarChoice, UserSubmission } from "@/lib/types"

interface AvatarOption {
  key: string
  label: string
  src: string
  url: string | null
  choice: AvatarChoice
}

interface TileState {
  current: string | null
  saving: string | null
  onPick: (option: AvatarOption) => void
  onBroken: (src: string) => void
}

const groupLabelClass = "text-xs font-medium uppercase tracking-wide text-unison-text-muted"

function AvatarTile({ option, current, saving, onPick, onBroken }: TileState & { option: AvatarOption }) {
  return (
    <Tooltip label={option.label}>
      <button
        type="button"
        aria-label={option.label}
        aria-pressed={option.url === current}
        disabled={saving !== null}
        onClick={() => onPick(option)}
        className="relative size-12 shrink-0 cursor-pointer rounded-full transition-transform active:scale-[0.96] disabled:cursor-wait aria-pressed:ring-2 aria-pressed:ring-unison-text aria-pressed:ring-offset-2 aria-pressed:ring-offset-unison-bg"
      >
        <img
          src={option.src}
          alt=""
          className="size-full rounded-full bg-unison-bg-hover object-cover"
          onError={() => onBroken(option.src)}
        />
        {saving === option.key ? (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
            <IconLoader2 className="size-5 animate-spin text-white" stroke={1.5} />
          </span>
        ) : null}
      </button>
    </Tooltip>
  )
}

function SongTile({
  submission,
  size,
  brokenSrcs,
  ...tile
}: TileState & { submission: UserSubmission; size: number; brokenSrcs: ReadonlySet<string> }) {
  const art = useArtwork(submission.videoId, { size })
  const url = art.data
  if (typeof url !== "string" || brokenSrcs.has(url)) return null
  return (
    <AvatarTile
      {...tile}
      option={{
        key: `song:${submission.videoId}`,
        label: `${submission.song} · ${submission.artist}`,
        src: url,
        url,
        choice: { type: "song", ref: submission.videoId },
      }}
    />
  )
}

function SongGroup({ keyId, ...rest }: TileState & { keyId: string; size: number; brokenSrcs: ReadonlySet<string> }) {
  const fetcher = useCallback(() => fetchUserSubmissions(keyId), [keyId])
  const submissions = useAsyncData(fetcher, `user:submissions:${keyId}`)
  if (submissions.status !== "success") return null
  const seen = new Set<string>()
  const songs = submissions.data.submissions.filter((s) => !seen.has(s.videoId) && seen.add(s.videoId))
  if (songs.length === 0) return null
  return (
    <div className="space-y-2">
      <div className={groupLabelClass}>From your songs</div>
      <div className="flex flex-wrap gap-2.5">
        {songs.map((s) => (
          <SongTile key={s.videoId} submission={s} {...rest} />
        ))}
      </div>
    </div>
  )
}

export function AvatarPicker({ discord }: { discord: DiscordLink }) {
  const session = useSession()
  const catalogue = useAsyncData(fetchAvatarCatalogue, "avatars:catalogue")
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [brokenSrcs, setBrokenSrcs] = useState<ReadonlySet<string>>(new Set())

  if (session.status !== "signed-in") return null
  const { identity, updateAvatarUrl } = session
  const current = identity.avatarUrl ?? null
  const discordPhoto =
    discord.discordAvatarUrl && !brokenSrcs.has(discord.discordAvatarUrl) ? discord.discordAvatarUrl : null

  const options: AvatarOption[] = [
    {
      key: "default",
      label: "Generated",
      src: dicebearThumbsDataUri(identity.keyId),
      url: null,
      choice: { type: "default" },
    },
    ...(discordPhoto
      ? [
          {
            key: "discord",
            label: "Discord photo",
            src: discordPhoto,
            url: discordPhoto,
            choice: { type: "discord" } as const,
          },
        ]
      : []),
    ...(catalogue.status === "success"
      ? catalogue.data.presets
          .filter((p) => !brokenSrcs.has(p.url))
          .map((p) => ({
            key: p.id,
            label: p.label,
            src: p.url,
            url: p.url,
            choice: { type: "preset", ref: p.id } as const,
          }))
      : []),
  ]

  async function pick(option: AvatarOption) {
    setSaving(option.key)
    setError(null)
    try {
      const { avatarUrl } = await putAvatar(option.choice)
      updateAvatarUrl(avatarUrl)
    } catch {
      setError("We could not save your picture. Please try again.")
    } finally {
      setSaving(null)
    }
  }

  const tile: TileState = {
    current,
    saving,
    onPick: pick,
    onBroken: (src) => setBrokenSrcs((prev) => new Set(prev).add(src)),
  }

  return (
    <div className={editableCardClass}>
      <div className="space-y-2">
        <div className={groupLabelClass}>Presets</div>
        <div className="flex flex-wrap gap-2.5">
          {options.map((option) => (
            <AvatarTile key={option.key} option={option} {...tile} />
          ))}
          {catalogue.status === "loading" ? (
            <IconLoader2 className="size-5 animate-spin self-center text-unison-text-muted" stroke={1.5} />
          ) : null}
        </div>
      </div>
      {catalogue.status === "success" ? (
        <SongGroup keyId={identity.keyId} size={catalogue.data.display.artworkSize} brokenSrcs={brokenSrcs} {...tile} />
      ) : null}
      {discord.status === "linked" && !discordPhoto ? (
        <>
          <p className="text-xs text-unison-text-muted">
            Reconnect Discord once to use your Discord photo. Accounts without a custom photo keep the generated one.
          </p>
          <button
            type="button"
            onClick={discord.connect}
            disabled={discord.connecting}
            className={secondaryButtonClass}
          >
            <IconBrandDiscordFilled className="size-4" />
            {discord.connecting ? "Connecting..." : "Use my Discord photo"}
          </button>
        </>
      ) : null}
      {catalogue.status === "error" ? (
        <p className="text-xs text-unison-text-muted">Preset pictures could not be loaded.</p>
      ) : null}
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
    </div>
  )
}
