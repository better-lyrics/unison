import { loadStoredSession } from "@/lib/auth"
import type { ApiEnvelope } from "@/lib/types"

export const AUTHED_FETCH_ERRORS = {
  AUTH_REQUIRED: "AUTH_REQUIRED",
  RATE_LIMITED: "RATE_LIMITED",
  REQUEST_FAILED: "REQUEST_FAILED",
  CONFLICT: "CONFLICT",
} as const

async function readServerError(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: unknown }
    return typeof body.error === "string" && body.error.length > 0 ? body.error : null
  } catch {
    return null
  }
}

function normaliseHeaders(input: HeadersInit | undefined): Record<string, string> {
  if (!input) return {}
  if (input instanceof Headers) {
    const out: Record<string, string> = {}
    input.forEach((value, key) => {
      out[key] = value
    })
    return out
  }
  if (Array.isArray(input)) {
    const out: Record<string, string> = {}
    for (const [key, value] of input) out[key] = value
    return out
  }
  return { ...input }
}

function hasAuthorization(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === "authorization")
}

export async function authedFetch<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const headers = normaliseHeaders(init?.headers)
  if (!hasAuthorization(headers)) {
    const session = loadStoredSession()
    if (session) headers.authorization = `Bearer ${session.sessionToken}`
  }
  const res = await fetch(input, { ...init, headers })
  if (res.status === 401) throw new Error(AUTHED_FETCH_ERRORS.AUTH_REQUIRED)
  if (res.status === 429) throw new Error(AUTHED_FETCH_ERRORS.RATE_LIMITED)
  if (res.status === 409) {
    const message = await readServerError(res)
    throw new Error(message ?? AUTHED_FETCH_ERRORS.CONFLICT)
  }
  if (!res.ok) {
    const message = await readServerError(res)
    throw new Error(message ?? AUTHED_FETCH_ERRORS.REQUEST_FAILED)
  }
  const body = (await res.json()) as ApiEnvelope<T>
  if (!body.success) throw new Error(AUTHED_FETCH_ERRORS.REQUEST_FAILED)
  return body.data
}
