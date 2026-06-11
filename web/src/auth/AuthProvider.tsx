import {
  type Identity,
  clearStoredSession,
  fetchChallenge,
  fetchMe,
  loadStoredSession,
  postSession,
  revokeSession,
  saveStoredSession,
} from "@/lib/auth"
import { detectBetterLyrics, signInWithBetterLyrics } from "@/lib/extension"
import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react"

type SessionState =
  | { status: "loading"; extensionAvailable: boolean }
  | { status: "signed-out"; extensionAvailable: boolean; signingIn: boolean; signIn: () => Promise<void> }
  | {
      status: "signed-in"
      extensionAvailable: boolean
      identity: Identity
      signOut: () => void
      updateDisplayName: (displayName: string) => void
    }
  | {
      status: "error"
      extensionAvailable: boolean
      signingIn: boolean
      error: Error
      signIn: () => Promise<void>
    }

const Ctx = createContext<SessionState | null>(null)

export function useSessionState(): SessionState {
  const state = useContext(Ctx)
  if (!state) throw new Error("useSession must be used within <AuthProvider>")
  return state
}

type Phase =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "signed-in"; identity: Identity }
  | { kind: "error"; error: Error }

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" })
  const [signingIn, setSigningIn] = useState(false)
  const [extensionAvailable, setExtensionAvailable] = useState<boolean | null>(null)
  const signInLock = useRef(false)

  useEffect(() => {
    let cancelled = false
    detectBetterLyrics().then((v) => {
      if (cancelled) return
      setExtensionAvailable(v === "available")
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const stored = loadStoredSession()
    if (!stored) {
      setPhase({ kind: "signed-out" })
      return
    }
    fetchMe(stored.sessionToken).then(
      (identity) => {
        if (cancelled) return
        saveStoredSession({ ...identity, sessionToken: stored.sessionToken })
        setPhase({ kind: "signed-in", identity })
      },
      () => {
        if (cancelled) return
        clearStoredSession()
        setPhase({ kind: "signed-out" })
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  const signIn = useCallback(async () => {
    if (signInLock.current) return
    signInLock.current = true
    setSigningIn(true)
    try {
      const { nonce } = await fetchChallenge()
      const signedBody = await signInWithBetterLyrics(nonce)
      const session = await postSession(signedBody)
      saveStoredSession(session)
      setPhase({
        kind: "signed-in",
        identity: {
          keyId: session.keyId,
          displayName: session.displayName,
          expiresAt: session.expiresAt,
        },
      })
    } catch (err) {
      setPhase({ kind: "error", error: err instanceof Error ? err : new Error(String(err)) })
    } finally {
      signInLock.current = false
      setSigningIn(false)
    }
  }, [])

  const signOut = useCallback(() => {
    const stored = loadStoredSession()
    if (stored) revokeSession(stored.sessionToken).catch(() => {})
    clearStoredSession()
    setPhase({ kind: "signed-out" })
  }, [])

  const updateDisplayName = useCallback((displayName: string) => {
    setPhase((prev) => {
      if (prev.kind !== "signed-in") return prev
      const stored = loadStoredSession()
      if (stored) saveStoredSession({ ...stored, displayName })
      return { kind: "signed-in", identity: { ...prev.identity, displayName } }
    })
  }, [])

  let state: SessionState
  if (phase.kind === "loading" || extensionAvailable === null) {
    state = { status: "loading", extensionAvailable: extensionAvailable ?? false }
  } else if (phase.kind === "signed-in")
    state = {
      status: "signed-in",
      extensionAvailable,
      identity: phase.identity,
      signOut,
      updateDisplayName,
    }
  else if (phase.kind === "error")
    state = { status: "error", extensionAvailable, signingIn, error: phase.error, signIn }
  else state = { status: "signed-out", extensionAvailable, signingIn, signIn }

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>
}
