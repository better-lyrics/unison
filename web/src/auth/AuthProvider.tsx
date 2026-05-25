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
import { requestSignedAssertion } from "@/lib/extension"
import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react"

type SessionState =
  | { status: "loading" }
  | { status: "signed-out"; signIn: () => Promise<void> }
  | { status: "signed-in"; identity: Identity; signOut: () => void }
  | { status: "error"; error: Error; signIn: () => Promise<void> }

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
    try {
      const { nonce } = await fetchChallenge()
      const signedBody = await requestSignedAssertion(nonce, window.location.origin)
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
    }
  }, [])

  const signOut = useCallback(() => {
    const stored = loadStoredSession()
    if (stored) revokeSession(stored.sessionToken).catch(() => {})
    clearStoredSession()
    setPhase({ kind: "signed-out" })
  }, [])

  let state: SessionState
  if (phase.kind === "loading") state = { status: "loading" }
  else if (phase.kind === "signed-in") state = { status: "signed-in", identity: phase.identity, signOut }
  else if (phase.kind === "error") state = { status: "error", error: phase.error, signIn }
  else state = { status: "signed-out", signIn }

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>
}
