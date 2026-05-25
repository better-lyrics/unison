import type { ApiEnvelope } from "./types"

export const STORAGE_KEY = "unison.session.v1"

export interface StoredSession {
  sessionToken: string
  keyId: string
  displayName: string
  expiresAt: number
}

export interface Identity {
  keyId: string
  displayName: string
  expiresAt: number
}

export interface SignedBody {
  payload: unknown
  signature: string
  publicKey: unknown
}

export interface Challenge {
  nonce: string
  expiresAt: number
}

function isValidStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  return (
    typeof v.sessionToken === "string" &&
    typeof v.keyId === "string" &&
    typeof v.displayName === "string" &&
    typeof v.expiresAt === "number"
  )
}

export function loadStoredSession(): StoredSession | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!isValidStoredSession(parsed)) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    if (parsed.expiresAt <= Math.floor(Date.now() / 1000)) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return parsed
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

export function saveStoredSession(session: StoredSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

export function clearStoredSession(): void {
  localStorage.removeItem(STORAGE_KEY)
}

async function unwrap<T>(res: Response): Promise<T> {
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new Error(`HTTP ${res.status}`)
  }
  if (!res.ok) {
    const err = (body as { error?: unknown }).error
    throw new Error(typeof err === "string" && err.length > 0 ? err : `HTTP ${res.status}`)
  }
  const envelope = body as ApiEnvelope<T>
  if (!envelope.success) throw new Error(envelope.error)
  return envelope.data
}

export async function fetchChallenge(): Promise<Challenge> {
  const res = await fetch("/auth/challenge")
  return unwrap<Challenge>(res)
}

export async function postSession(signedBody: SignedBody): Promise<StoredSession> {
  const res = await fetch("/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(signedBody),
  })
  return unwrap<StoredSession>(res)
}

export async function fetchMe(token: string): Promise<Identity> {
  const res = await fetch("/auth/me", {
    headers: { authorization: `Bearer ${token}` },
  })
  return unwrap<Identity>(res)
}

export async function revokeSession(token: string): Promise<void> {
  await fetch("/auth/logout", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  })
}
