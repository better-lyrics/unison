import { loadStoredSession } from "@/lib/auth"
import type { ApiEnvelope } from "@/lib/types"

export const AUTHED_FETCH_ERRORS = {
  AUTH_REQUIRED: "AUTH_REQUIRED",
  RATE_LIMITED: "RATE_LIMITED",
  REQUEST_FAILED: "REQUEST_FAILED",
  CONFLICT: "CONFLICT",
} as const

export class AuthedFetchError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly hint: string | null = null,
  ) {
    super(message)
    this.name = "AuthedFetchError"
  }
}

async function readServerError(res: Response): Promise<{ error: string | null; hint: string | null }> {
  const text = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : null)
  try {
    const body = (await res.json()) as { error?: unknown; hint?: unknown }
    return { error: text(body.error), hint: text(body.hint) }
  } catch {
    return { error: null, hint: null }
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
  if (res.status === 401) throw new AuthedFetchError(AUTHED_FETCH_ERRORS.AUTH_REQUIRED, 401)
  if (res.status === 429) throw new AuthedFetchError(AUTHED_FETCH_ERRORS.RATE_LIMITED, 429)
  if (!res.ok) {
    const { error, hint } = await readServerError(res)
    const fallback = res.status === 409 ? AUTHED_FETCH_ERRORS.CONFLICT : AUTHED_FETCH_ERRORS.REQUEST_FAILED
    throw new AuthedFetchError(error ?? fallback, res.status, hint)
  }
  const body = (await res.json()) as ApiEnvelope<T>
  if (!body.success) throw new AuthedFetchError(AUTHED_FETCH_ERRORS.REQUEST_FAILED, res.status)
  return body.data
}
