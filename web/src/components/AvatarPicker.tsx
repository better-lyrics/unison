import { IconBrandDiscordFilled, IconLoader2 } from "@tabler/icons-react"
import { useState } from "react"
import { useSession } from "@/auth/useSession"
import { secondaryButtonClass } from "@/components/discord-ui"
import { Tooltip } from "@/components/Tooltip"
import { editableCardClass } from "@/components/ui"
import { useAsyncData } from "@/hooks/useAsyncData"
import type { DiscordLink } from "@/hooks/useDiscordLink"
import { fetchAvatarCatalogue, putAvatar } from "@/lib/api"
import { dicebearThumbsDataUri } from "@/lib/avatar"
import type { AvatarChoice } from "@/lib/types"

interface AvatarOption {
  key: string
  label: string
  src: string
  url: string | null
  choice: AvatarChoice
}

export function AvatarPicker({ discord }: { discord: DiscordLink }) {
  const session = useSession()
  const catalogue = useAsyncData(fetchAvatarCatalogue, "avatars:catalogue")
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (session.status !== "signed-in") return null
  const { identity, updateAvatarUrl } = session
  const current = identity.avatarUrl ?? null

  const options: AvatarOption[] = [
    {
      key: "default",
      label: "Generated",
      src: dicebearThumbsDataUri(identity.keyId),
      url: null,
      choice: { type: "default" },
    },
    ...(discord.discordAvatarUrl
      ? [
          {
            key: "discord",
            label: "Discord photo",
            src: discord.discordAvatarUrl,
            url: discord.discordAvatarUrl,
            choice: { type: "discord" } as const,
          },
        ]
      : []),
    ...(catalogue.status === "success"
      ? catalogue.data.presets.map((p) => ({
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

  return (
    <div className={editableCardClass}>
      <div className="flex flex-wrap gap-2.5">
        {options.map((option) => (
          <Tooltip key={option.key} label={option.label}>
            <button
              type="button"
              aria-label={option.label}
              aria-pressed={option.url === current}
              disabled={saving !== null}
              onClick={() => pick(option)}
              className="relative size-12 shrink-0 cursor-pointer rounded-full transition-transform active:scale-[0.96] disabled:cursor-wait aria-pressed:ring-2 aria-pressed:ring-unison-text aria-pressed:ring-offset-2 aria-pressed:ring-offset-unison-bg"
            >
              <img src={option.src} alt="" className="size-full rounded-full bg-unison-bg-hover object-cover" />
              {saving === option.key ? (
                <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
                  <IconLoader2 className="size-5 animate-spin text-white" stroke={1.5} />
                </span>
              ) : null}
            </button>
          </Tooltip>
        ))}
        {catalogue.status === "loading" ? (
          <IconLoader2 className="size-5 animate-spin self-center text-unison-text-muted" stroke={1.5} />
        ) : null}
      </div>
      {discord.status === "linked" && !discord.discordAvatarUrl ? (
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
