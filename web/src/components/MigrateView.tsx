import {
  AuthFlowBody as Body,
  AuthFlowError as ErrorText,
  AuthFlowLayout as Layout,
  AuthFlowTitle as Title,
} from "@/components/AuthFlowLayout"
import { discordButtonClass, secondaryButtonClass } from "@/components/discord-ui"
import {
  IconAlertTriangle,
  IconBrandDiscordFilled,
  IconCircleCheck,
  IconLoader2,
  IconProgressDown,
} from "@tabler/icons-react"

const installIcon = <IconProgressDown className="size-7 text-unison-text-secondary" stroke={1.5} />
const discordIcon = <IconBrandDiscordFilled className="size-7 text-white" />
const warnIcon = <IconAlertTriangle className="size-7 text-amber-400" stroke={1.5} />
const successIcon = <IconCircleCheck className="size-7 text-emerald-400" stroke={1.5} />

export type MigrateViewModel =
  | { kind: "loading" }
  | { kind: "install" }
  | { kind: "prove"; connecting: boolean; error: string | null; onConnect: () => void }
  | { kind: "ready"; name: string | null }
  | { kind: "same_key" }
  | { kind: "expired" }
  | { kind: "error" }
  | { kind: "start" }

export function MigrateView({ model }: { model: MigrateViewModel }) {
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
          <Title>Install Better Lyrics here</Title>
          <Body>
            Proving your new key happens through the Better Lyrics extension. Install it on this device, then reopen the
            link from Discord.
          </Body>
          <a href="https://betterlyrics.org" target="_blank" rel="noopener noreferrer" className={secondaryButtonClass}>
            Get Better Lyrics
          </a>
        </Layout>
      )

    case "prove":
      return (
        <Layout partner={discordIcon} pulsing={model.connecting}>
          <Title>Prove your new key</Title>
          <Body>
            Confirm this is your new Better Lyrics install so we can move your history onto it. Two quick taps: confirm
            it is you in Better Lyrics, then approve Discord.
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

    case "ready":
      return (
        <Layout partner={successIcon}>
          <Title>New key verified</Title>
          <Body>
            You are verified{model.name ? ` as ${model.name}` : ""}. Head back to Discord and press Continue to review
            and confirm the move.
          </Body>
        </Layout>
      )

    case "same_key":
      return (
        <Layout partner={warnIcon}>
          <Title>Same key</Title>
          <Body>This install already uses the key you are migrating from, so there is nothing to move.</Body>
        </Layout>
      )

    case "expired":
      return (
        <Layout partner={warnIcon}>
          <Title>That timed out</Title>
          <Body>This migration expired before it finished. Run /migrate in Discord to start a fresh one.</Body>
        </Layout>
      )

    case "error":
      return (
        <Layout partner={warnIcon}>
          <Title>Something went wrong</Title>
          <Body>We could not verify your new key. Run /migrate in Discord to try again.</Body>
        </Layout>
      )

    case "start":
      return (
        <Layout partner={discordIcon}>
          <Title>Start from Discord</Title>
          <Body>Account migrations begin in Discord. Run /migrate there and open the link it gives you.</Body>
        </Layout>
      )
  }
}
