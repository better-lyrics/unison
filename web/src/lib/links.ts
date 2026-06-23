import type { SignedBody } from "./auth"

interface ApiOk<T> {
  success: true
  data: T
}
interface ApiErr {
  success: false
  error: string
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
  const envelope = body as ApiOk<T> | ApiErr
  if (!envelope.success) throw new Error(envelope.error)
  return envelope.data
}

export interface LinkStatus {
  linked: boolean
  discordId: string | null
  discordUsername: string | null
}

export async function startDiscordLink(signedBody: SignedBody): Promise<{ authorizeUrl: string }> {
  const res = await fetch("/links/discord/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(signedBody),
  })
  return unwrap<{ authorizeUrl: string }>(res)
}

export async function fetchLinkStatus(token: string): Promise<LinkStatus> {
  const res = await fetch("/links/me", { headers: { authorization: `Bearer ${token}` } })
  return unwrap<LinkStatus>(res)
}

export async function unlinkDiscord(token: string): Promise<void> {
  const res = await fetch("/links/discord", {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  })
  await unwrap<{ unlinked: boolean }>(res)
}
