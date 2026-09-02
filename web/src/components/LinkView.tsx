import {
  AuthFlowBody as Body,
  AuthFlowError as ErrorText,
  AuthFlowLayout as Layout,
  AuthFlowTitle as Title,
} from "@/components/AuthFlowLayout"
import { discordButtonClass, secondaryButtonClass } from "@/components/discord-ui"
import { IconAlertTriangle, IconBrandDiscordFilled, IconLoader2, IconProgressDown } from "@tabler/icons-react"

const installIcon = <IconProgressDown className="size-7 text-unison-text-secondary" stroke={1.5} />
const discordIcon = <IconBrandDiscordFilled className="size-7 text-white" />
const warnIcon = <IconAlertTriangle className="size-7 text-amber-400" stroke={1.5} />

export type LinkViewModel =
  | { kind: "loading" }
  | { kind: "install" }
  | { kind: "connect"; connecting: boolean; error: string | null; onConnect: () => void }
  | { kind: "existing"; name: string | null; working: boolean; error: string | null; onDisconnect: () => void }
  | { kind: "linked"; name: string | null }
  | { kind: "blocked" }
  | { kind: "expired"; onReset: () => void }
  | { kind: "error"; onReset: () => void }

export function LinkView({ model }: { model: LinkViewModel }) {
  switch (model.kind) {
    case "loading":
      return (
        <Layout partner={discordIcon} pulsing>
          <IconLoader2 className="size-6 animate-spin text-unison-text-muted" stroke={1.5} />
        </Layout>
      )

    case "install":
      return (
        <Layout partner={installIcon}>
          <Title>Install Better Lyrics first</Title>
          <Body>
            Linking happens through the Better Lyrics extension. Install it, then come back to this page to connect your
            Discord.
          </Body>
          <a href="https://betterlyrics.org" target="_blank" rel="noopener noreferrer" className={secondaryButtonClass}>
            Get Better Lyrics
          </a>
        </Layout>
      )

    case "connect":
      return (
        <Layout partner={discordIcon} pulsing={model.connecting}>
          <Title>Connect Better Lyrics to Discord</Title>
          <Body>
            Link once to earn your leaderboard roles and get credit for the songs you add. It takes two quick taps:
            confirm it is you in Better Lyrics, then approve Discord.
          </Body>
          <button type="button" onClick={model.onConnect} disabled={model.connecting} className={discordButtonClass}>
            {model.connecting ? (
              <IconLoader2 className="size-5 animate-spin" stroke={1.5} />
            ) : (
              <IconBrandDiscordFilled className="size-5" />
            )}
            {model.connecting ? "Connecting..." : "Connect with Discord"}
          </button>
          {model.error ? <ErrorText>{model.error}</ErrorText> : null}
        </Layout>
      )

    case "existing":
      return (
        <Layout partner={discordIcon}>
          <Title>Connected to Discord</Title>
          <Body>Your account is linked{model.name ? ` as ${model.name}` : ""}. Roles update on their own.</Body>
          <button type="button" onClick={model.onDisconnect} disabled={model.working} className={secondaryButtonClass}>
            {model.working ? "Disconnecting..." : "Disconnect"}
          </button>
          {model.error ? <ErrorText>{model.error}</ErrorText> : null}
        </Layout>
      )

    case "linked":
      return (
        <Layout partner={discordIcon}>
          <Title>You are all set</Title>
          <Body>
            Your Discord is linked to Better Lyrics{model.name ? ` as ${model.name}` : ""}. Your roles update on their
            own, so you can head back to Discord now.
          </Body>
        </Layout>
      )

    case "blocked":
      return (
        <Layout partner={warnIcon}>
          <Title>This account cannot be linked</Title>
          <Body>
            This looks like a shared community account, so it cannot be connected to a personal Discord. If that is a
            surprise, reach out to a moderator.
          </Body>
        </Layout>
      )

    case "expired":
      return (
        <Layout partner={warnIcon}>
          <Title>That timed out</Title>
          <Body>The link request expired before it finished. Start over and it will only take a moment.</Body>
          <button type="button" onClick={model.onReset} className={secondaryButtonClass}>
            Start over
          </button>
        </Layout>
      )

    case "error":
      return (
        <Layout partner={warnIcon}>
          <Title>Something went wrong</Title>
          <Body>We could not finish linking your account. Give it another try.</Body>
          <button type="button" onClick={model.onReset} className={secondaryButtonClass}>
            Try again
          </button>
        </Layout>
      )
  }
}
