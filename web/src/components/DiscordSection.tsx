import { IconBrandDiscordFilled, IconLoader2 } from "@tabler/icons-react"
import { discordButtonClass, secondaryButtonClass } from "@/components/discord-ui"
import { useDiscordLink } from "@/hooks/useDiscordLink"

export interface DiscordSectionModel {
  status: "loading" | "linked" | "unlinked"
  username: string | null
  connecting: boolean
  working: boolean
  error: string | null
  onConnect: () => void
  onDisconnect: () => void
}

const cardClass = "space-y-3 rounded-lg border border-unison-border bg-unison-bg-elevated p-4"

export function DiscordSectionView({ model }: { model: DiscordSectionModel }) {
  if (model.status === "loading") {
    return (
      <div className={cardClass}>
        <IconLoader2 className="size-5 animate-spin text-unison-text-muted" stroke={1.5} />
      </div>
    )
  }

  if (model.status === "linked") {
    return (
      <div className={cardClass}>
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
    <div className={cardClass}>
      <p className="text-sm text-unison-text-secondary">
        Link your Discord to earn leaderboard roles and get credit for the songs you add.
      </p>
      <button type="button" onClick={model.onConnect} disabled={model.connecting} className={discordButtonClass}>
        {model.connecting ? (
          <IconLoader2 className="size-5 animate-spin" stroke={1.5} />
        ) : (
          <IconBrandDiscordFilled className="size-5" />
        )}
        {model.connecting ? "Connecting..." : "Connect with Discord"}
      </button>
      {model.error ? <p className="text-xs text-red-400">{model.error}</p> : null}
    </div>
  )
}

export function DiscordSection() {
  const link = useDiscordLink()
  return (
    <DiscordSectionView
      model={{
        status: link.status,
        username: link.username,
        connecting: link.connecting,
        working: link.working,
        error: link.error,
        onConnect: link.connect,
        onDisconnect: link.disconnect,
      }}
    />
  )
}
