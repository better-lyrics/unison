import { loadStoredSession } from "@/lib/auth"
import { authedFetch, AUTHED_FETCH_ERRORS } from "@/lib/authedFetch"

export interface AvailabilityResponse {
  available: boolean
  reason?: "INVALID_FORMAT" | "TAKEN" | "SELF"
}

export interface NicknameMutationResponse {
  keyId: string
  displayName: string
}

async function readServerError(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: unknown }
    return typeof body.error === "string" && body.error.length > 0 ? body.error : null
  } catch {
    return null
  }
}

export async function checkNicknameAvailability(name: string): Promise<AvailabilityResponse> {
  const headers: Record<string, string> = {}
  const session = loadStoredSession()
  if (session) headers.authorization = `Bearer ${session.sessionToken}`
  const res = await fetch(`/auth/nickname/availability?name=${encodeURIComponent(name)}`, { headers })
  if (res.status === 401) throw new Error(AUTHED_FETCH_ERRORS.AUTH_REQUIRED)
  if (res.status === 429) throw new Error(AUTHED_FETCH_ERRORS.RATE_LIMITED)
  if (!res.ok) {
    const message = await readServerError(res)
    throw new Error(message ?? AUTHED_FETCH_ERRORS.REQUEST_FAILED)
  }
  return (await res.json()) as AvailabilityResponse
}

export async function putNickname(nickname: string): Promise<NicknameMutationResponse> {
  return authedFetch<NicknameMutationResponse>("/auth/nickname", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nickname }),
  })
}

export async function deleteNickname(): Promise<NicknameMutationResponse> {
  return authedFetch<NicknameMutationResponse>("/auth/nickname", { method: "DELETE" })
}
