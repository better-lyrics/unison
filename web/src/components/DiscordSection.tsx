import { IconBrandDiscordFilled, IconLoader2 } from "@tabler/icons-react"
import { DiscordConnectLock, discordButtonClass, secondaryButtonClass } from "@/components/discord-ui"
import { editableCardClass } from "@/components/ui"
import type { DiscordLink } from "@/hooks/useDiscordLink"

export interface DiscordSectionModel {
  status: "loading" | "linked" | "unlinked"
  username: string | null
  connecting: boolean
  canConnect: boolean
  working: boolean
  error: string | null
  onConnect: () => void
  onDisconnect: () => void
}

export function DiscordSectionView({ model }: { model: DiscordSectionModel }) {
  if (model.status === "loading") {
    return (
      <div className={editableCardClass}>
        <IconLoader2 className="size-5 animate-spin text-unison-text-muted" stroke={1.5} />
      </div>
    )
  }

  if (model.status === "linked") {
    return (
      <div className={editableCardClass}>
        <p className="text-sm text-unison-text">
          Connected{model.username ? ` as ${model.username}` : ""}. Your roles update on their own.
        </p>
        <button type="button" onClick={model.onDisconnect} disabled={model.working} className={secondaryButtonClass}>
          {model.working ? "Disconnecting..." : "Disconnect"}
        </button>
        {model.error ? <p className="text-xs text-red-400">{model.error}</p> : null}
      </div>
    )
  }

  return (
    <div className={editableCardClass}>
      <p className="text-sm text-unison-text-secondary">
        Link your Discord to earn leaderboard roles and get credit for the songs you add.
      </p>
      <DiscordConnectLock locked={!model.canConnect}>
        <button
          type="button"
          onClick={model.canConnect ? model.onConnect : undefined}
          disabled={model.connecting}
          aria-disabled={!model.canConnect}
          className={`${discordButtonClass} aria-disabled:cursor-not-allowed aria-disabled:opacity-60`}
        >
          {model.connecting ? (
            <IconLoader2 className="size-5 animate-spin" stroke={1.5} />
          ) : (
            <IconBrandDiscordFilled className="size-5" />
          )}
          {model.connecting ? "Connecting..." : "Connect with Discord"}
        </button>
      </DiscordConnectLock>
      {model.error ? <p className="text-xs text-red-400">{model.error}</p> : null}
    </div>
  )
}

export function DiscordSection({ link }: { link: DiscordLink }) {
  return (
    <DiscordSectionView
      model={{
        status: link.status,
        username: link.username,
        connecting: link.connecting,
        canConnect: link.canConnect,
        working: link.working,
        error: link.error,
        onConnect: link.connect,
        onDisconnect: link.disconnect,
      }}
    />
  )
}
