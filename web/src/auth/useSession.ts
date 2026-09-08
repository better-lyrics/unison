import { useContext } from "react"
import { SessionContext } from "./AuthProvider"

export { useSessionState as useSession } from "./AuthProvider"

// Returns the session when inside an <AuthProvider>, or null when there is none.
// Public profile pages use this to detect whether the viewer owns the profile
// without requiring a provider (e.g. in isolated tests).
export function useOptionalSession() {
  return useContext(SessionContext)
}
