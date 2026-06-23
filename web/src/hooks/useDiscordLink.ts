import { useCallback, useEffect, useState } from "react"
import { fetchChallenge, loadStoredSession } from "@/lib/auth"
import { signInWithBetterLyrics } from "@/lib/extension"
import { fetchLinkStatus, startDiscordLink, unlinkDiscord } from "@/lib/links"

type Status = "loading" | "linked" | "unlinked"

export interface DiscordLink {
  status: Status
  username: string | null
  connecting: boolean
  working: boolean
  error: string | null
  connect: () => Promise<void>
  disconnect: () => Promise<void>
}

export function useDiscordLink({ enabled = true }: { enabled?: boolean } = {}): DiscordLink {
  const [status, setStatus] = useState<Status>(enabled ? "loading" : "unlinked")
  const [username, setUsername] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    const stored = loadStoredSession()
    if (!stored) {
      setStatus("unlinked")
      return
    }
    let cancelled = false
    fetchLinkStatus(stored.sessionToken)
      .then((s) => {
        if (cancelled) return
        setStatus(s.linked ? "linked" : "unlinked")
        setUsername(s.linked ? s.discordUsername : null)
      })
      .catch(() => {
        if (!cancelled) setStatus("unlinked")
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

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
    setError(null)
    try {
      await unlinkDiscord(stored.sessionToken)
      setStatus("unlinked")
      setUsername(null)
    } catch {
      setError("We could not disconnect just now. Please try again.")
    } finally {
      setWorking(false)
    }
  }, [])

  return { status, username, connecting, working, error, connect, disconnect }
}
