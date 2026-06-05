import type { StoredSession } from "./auth"

// Set VITE_SEED=spa-expansion (env) or ?seed=spa-expansion (URL) in dev to swap the API client
// onto an in-memory corpus, so search, lyrics, voting, and queue pages can be poked locally with
// no backend. Gated on import.meta.env.DEV so production builds tree-shake it.
const seedEnv = (import.meta.env.VITE_SEED ?? "").toString().toLowerCase()
const seedQuery = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("seed") : null
export const IS_SPA_EXPANSION_SEED =
  import.meta.env.DEV && (seedEnv === "spa-expansion" || seedQuery === "spa-expansion")

const SECONDS_IN_DAY = 24 * 60 * 60
const SEED_SESSION_KEY_ID = "f".repeat(64)

export function getSeedSession(): StoredSession {
  return {
    sessionToken: "spa-expansion-dev-token",
    keyId: SEED_SESSION_KEY_ID,
    displayName: "Local Tester",
    expiresAt: Math.floor(Date.now() / 1000) + SECONDS_IN_DAY,
  }
}
