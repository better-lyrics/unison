import { useContext, useState } from "react"
import { loadStoredSession } from "@/lib/auth"
import { toHandle } from "@/lib/handle"
import { SessionContext } from "./AuthProvider"

export { useSessionState as useSession } from "./AuthProvider"

// Returns the session when inside an <AuthProvider>, or null when there is none.
// Public profile pages use this to detect whether the viewer owns the profile
// without requiring a provider (e.g. in isolated tests).
export function useOptionalSession() {
  return useContext(SessionContext)
}

// Falls back to the stored session while the live one loads, so a profile skeleton keeps its shape.
export function useViewerOwns({ keyId, handle }: { keyId?: string; handle?: string }): boolean {
  const session = useOptionalSession()
  const [stored] = useState(loadStoredSession)
  const identity = session?.status === "signed-in" ? session.identity : session?.status === "loading" ? stored : null
  if (!identity) return false
  if (keyId) return identity.keyId === keyId
  return handle ? toHandle(identity.displayName) === handle : false
}
