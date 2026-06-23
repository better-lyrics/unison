import { IconAlertTriangle, IconBrandDiscord, IconCircleCheck, IconLoader2, IconPuzzle } from "@tabler/icons-react"
import { useCallback, useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useSession } from "@/auth/useSession"
import { BetterLyricsLogo } from "@/components/BetterLyricsLogo"
import { fetchChallenge, loadStoredSession } from "@/lib/auth"
import { signInWithBetterLyrics } from "@/lib/extension"
import { fetchLinkStatus, startDiscordLink, unlinkDiscord } from "@/lib/links"

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-6 py-10 text-center">
      <BetterLyricsLogo size={44} />
      {children}
    </div>
  )
}

function Title({ children }: { children: React.ReactNode }) {
  return <h1 className="text-xl font-semibold text-unison-text">{children}</h1>
}

function Body({ children }: { children: React.ReactNode }) {
  return <p className="max-w-sm text-sm leading-relaxed text-unison-text-secondary">{children}</p>
}

const discordButtonClass =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-md bg-[#5865f2] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#4752c4] disabled:cursor-not-allowed disabled:opacity-60"

const secondaryButtonClass =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-md bg-unison-bg-elevated px-4 py-2.5 text-sm font-medium text-unison-text transition-colors hover:bg-unison-bg-hover disabled:cursor-not-allowed disabled:opacity-60"

function OutcomeScreen({ status, name, onReset }: { status: string; name: string | null; onReset: () => void }) {
  if (status === "linked") {
    return (
      <Shell>
        <IconCircleCheck className="size-12 text-emerald-400" stroke={1.5} />
        <Title>You are all set</Title>
        <Body>
          Your Discord is linked to Better Lyrics{name ? ` as ${name}` : ""}. Your roles update on their own, so you can
          head back to Discord now.
        </Body>
      </Shell>
    )
  }
  if (status === "blocked") {
    return (
      <Shell>
        <IconAlertTriangle className="size-12 text-amber-400" stroke={1.5} />
        <Title>This account cannot be linked</Title>
        <Body>
          This looks like a shared community account, so it cannot be connected to a personal Discord. If that is a
          surprise, reach out to a moderator.
        </Body>
      </Shell>
    )
  }
  const isExpired = status === "expired"
  return (
    <Shell>
      <IconAlertTriangle className="size-12 text-amber-400" stroke={1.5} />
      <Title>{isExpired ? "That timed out" : "Something went wrong"}</Title>
      <Body>
        {isExpired
          ? "The link request expired before it finished. Start over and it will only take a moment."
          : "We could not finish linking your account. Give it another try."}
      </Body>
      <button type="button" onClick={onReset} className={secondaryButtonClass}>
        {isExpired ? "Start over" : "Try again"}
      </button>
    </Shell>
  )
}

export function LinkPage() {
  const session = useSession()
  const [params, setParams] = useSearchParams()
  const outcome = params.get("status")

  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [existing, setExisting] = useState<{ username: string | null } | null>(null)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    if (outcome) return
    const stored = loadStoredSession()
    if (!stored) return
    let cancelled = false
    fetchLinkStatus(stored.sessionToken)
      .then((s) => {
        if (cancelled) return
        setExisting(s.linked ? { username: s.discordUsername } : null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [outcome])

  const connect = useCallback(async () => {
    setConnecting(true)
    setError(null)
    try {
      const { nonce } = await fetchChallenge()
      const signedBody = await signInWithBetterLyrics(nonce)
      const { authorizeUrl } = await startDiscordLink(signedBody)
      window.location.assign(authorizeUrl)
    } catch (err) {
      const message = err instanceof Error ? err.message : ""
      setError(
        message.includes("cannot be linked")
          ? "This account cannot be linked. It looks like a shared community account."
          : "We could not start the link. Make sure Better Lyrics is installed, then try again.",
      )
      setConnecting(false)
    }
  }, [])

  const disconnect = useCallback(async () => {
    const stored = loadStoredSession()
    if (!stored) return
    setWorking(true)
    try {
      await unlinkDiscord(stored.sessionToken)
      setExisting(null)
    } catch {
      setError("We could not disconnect just now. Please try again.")
    } finally {
      setWorking(false)
    }
  }, [])

  if (outcome) {
    return <OutcomeScreen status={outcome} name={params.get("name")} onReset={() => setParams({})} />
  }

  if (session.status === "loading") {
    return (
      <Shell>
        <IconLoader2 className="size-8 animate-spin text-unison-text-muted" stroke={1.5} />
      </Shell>
    )
  }

  if (!session.extensionAvailable) {
    return (
      <Shell>
        <IconPuzzle className="size-12 text-unison-text-muted" stroke={1.5} />
        <Title>Install Better Lyrics first</Title>
        <Body>
          Linking happens through the Better Lyrics extension. Install it, then come back to this page to connect your
          Discord.
        </Body>
        <a href="https://betterlyrics.org" target="_blank" rel="noopener noreferrer" className={secondaryButtonClass}>
          Get Better Lyrics
        </a>
      </Shell>
    )
  }

  if (existing) {
    return (
      <Shell>
        <IconCircleCheck className="size-12 text-emerald-400" stroke={1.5} />
        <Title>Connected to Discord</Title>
        <Body>
          Your account is linked{existing.username ? ` as ${existing.username}` : ""}. Roles update on their own.
        </Body>
        <button type="button" onClick={disconnect} disabled={working} className={secondaryButtonClass}>
          {working ? "Disconnecting..." : "Disconnect"}
        </button>
      </Shell>
    )
  }

  return (
    <Shell>
      <Title>Connect Better Lyrics to Discord</Title>
      <Body>
        Link once to earn your leaderboard roles and get credit for the songs you add. It takes two quick taps: confirm
        it is you in Better Lyrics, then approve Discord.
      </Body>
      <button type="button" onClick={connect} disabled={connecting} className={discordButtonClass}>
        {connecting ? (
          <IconLoader2 className="size-5 animate-spin" stroke={1.5} />
        ) : (
          <IconBrandDiscord className="size-5" stroke={1.5} />
        )}
        {connecting ? "Connecting..." : "Connect with Discord"}
      </button>
      {error ? <p className="max-w-sm text-sm text-red-400">{error}</p> : null}
    </Shell>
  )
}
