import {
  type Identity,
  clearStoredSession,
  fetchChallenge,
  fetchMe,
  loadStoredSession,
  postSession,
  revokeSession,
  type SignedBody,
  saveStoredSession,
} from "@/lib/auth"
import { findBetterLyrics, signInWithBetterLyrics } from "@/lib/extension"
import { signInWithIdentityFile } from "@/lib/identity-file"
import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react"

type SessionState =
  | { status: "loading"; extensionAvailable: boolean; extensionId: string | null }
  | {
      status: "signed-out"
      extensionAvailable: boolean
      extensionId: string | null
      signingIn: boolean
      signIn: () => Promise<void>
      signInWithFile: (file: File) => Promise<void>
    }
  | {
      status: "signed-in"
      extensionAvailable: boolean
      extensionId: string | null
      identity: Identity
      signOut: () => void
      updateDisplayName: (displayName: string) => void
      updateAvatarUrl: (avatarUrl: string | null) => void
    }
  | {
      status: "error"
      extensionAvailable: boolean
      extensionId: string | null
      signingIn: boolean
      error: Error
      signIn: () => Promise<void>
      signInWithFile: (file: File) => Promise<void>
    }

const Ctx = createContext<SessionState | null>(null)

// Exposed so dev preview pages can mount a fixture session around real pages.
export { Ctx as SessionContext }

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
  const [extensionId, setExtensionId] = useState<string | null | undefined>(undefined)
  const signInLock = useRef(false)

  useEffect(() => {
    let cancelled = false
    findBetterLyrics().then((id) => {
      if (!cancelled) setExtensionId(id)
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

  const completeSignIn = useCallback(async (sign: (nonce: string) => Promise<SignedBody>) => {
    if (signInLock.current) return
    signInLock.current = true
    setSigningIn(true)
    try {
      const { nonce } = await fetchChallenge()
      const signedBody = await sign(nonce)
      const session = await postSession(signedBody)
      saveStoredSession(session)
      setPhase({
        kind: "signed-in",
        identity: {
          keyId: session.keyId,
          displayName: session.displayName,
          expiresAt: session.expiresAt,
          avatarUrl: session.avatarUrl,
        },
      })
    } catch (err) {
      setPhase({ kind: "error", error: err instanceof Error ? err : new Error(String(err)) })
    } finally {
      signInLock.current = false
      setSigningIn(false)
    }
  }, [])

  const signIn = useCallback(
    () =>
      completeSignIn((nonce) => {
        if (!extensionId) throw new Error("Better Lyrics extension not detected")
        return signInWithBetterLyrics(nonce, extensionId)
      }),
    [completeSignIn, extensionId],
  )

  const signInWithFile = useCallback(
    (file: File) => completeSignIn((nonce) => signInWithIdentityFile(file, nonce)),
    [completeSignIn],
  )

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

  const updateAvatarUrl = useCallback((avatarUrl: string | null) => {
    setPhase((prev) => {
      if (prev.kind !== "signed-in") return prev
      const stored = loadStoredSession()
      if (stored) saveStoredSession({ ...stored, avatarUrl })
      return { kind: "signed-in", identity: { ...prev.identity, avatarUrl } }
    })
  }, [])

  let state: SessionState
  if (phase.kind === "loading" || extensionId === undefined) {
    state = { status: "loading", extensionAvailable: false, extensionId: null }
  } else {
    const extension = { extensionAvailable: extensionId !== null, extensionId }
    if (phase.kind === "signed-in")
      state = {
        status: "signed-in",
        ...extension,
        identity: phase.identity,
        signOut,
        updateDisplayName,
        updateAvatarUrl,
      }
    else if (phase.kind === "error")
      state = { status: "error", ...extension, signingIn, error: phase.error, signIn, signInWithFile }
    else state = { status: "signed-out", ...extension, signingIn, signIn, signInWithFile }
  }

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>
}
