export interface StoredSession {
  sessionToken: string
  keyId: string
  displayName: string
  expiresAt: number
  avatarUrl?: string | null
  council?: { admin: boolean } | null
}
