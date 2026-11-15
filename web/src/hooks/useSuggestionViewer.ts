import { useOptionalSession } from "@/auth/useSession"

export interface SuggestionViewer {
  keyId: string
  council: boolean
  canSuggest: boolean
}

export function useSuggestionViewer(): SuggestionViewer | null {
  const session = useOptionalSession()
  if (session?.status !== "signed-in") return null
  const { identity } = session
  return { keyId: identity.keyId, council: Boolean(identity.council), canSuggest: identity.canSuggest !== false }
}
