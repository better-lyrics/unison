import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { StoredSession } from "@/lib/auth"

const loadStoredSessionMock = vi.fn<() => StoredSession | null>()

vi.mock("@/lib/auth", () => ({
  loadStoredSession: () => loadStoredSessionMock(),
}))

let authedFetch: typeof import("./authedFetch").authedFetch
let AUTHED_FETCH_ERRORS: typeof import("./authedFetch").AUTHED_FETCH_ERRORS

beforeEach(async () => {
  loadStoredSessionMock.mockReset()
  const mod = await import("./authedFetch")
  authedFetch = mod.authedFetch
  AUTHED_FETCH_ERRORS = mod.AUTHED_FETCH_ERRORS
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const session: StoredSession = {
  sessionToken: "abc.tok",
  keyId: "k".repeat(64),
  displayName: "Tester",
  expiresAt: Math.floor(Date.now() / 1000) + 1000,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

describe("authedFetch", () => {
  it("returns the envelope data on 200 and attaches a Bearer when signed-in", async () => {
    loadStoredSessionMock.mockReturnValue(session)
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: { hi: 1 } }))
    vi.stubGlobal("fetch", fetchFn)
    const data = await authedFetch<{ hi: number }>("/some/path")
    expect(data).toEqual({ hi: 1 })
    const init = fetchFn.mock.calls[0][1] as RequestInit | undefined
    const headers = init?.headers as Record<string, string> | undefined
    expect(headers?.authorization).toBe(`Bearer ${session.sessionToken}`)
  })

  it("omits the Bearer header when signed-out", async () => {
    loadStoredSessionMock.mockReturnValue(null)
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: "ok" }))
    vi.stubGlobal("fetch", fetchFn)
    const data = await authedFetch<string>("/some/path")
    expect(data).toBe("ok")
    const init = fetchFn.mock.calls[0][1] as RequestInit | undefined
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers.authorization).toBeUndefined()
  })

  it("passes through caller-supplied headers other than authorization", async () => {
    loadStoredSessionMock.mockReturnValue(session)
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: 1 }))
    vi.stubGlobal("fetch", fetchFn)
    await authedFetch("/x", { headers: { "x-custom": "yes", "content-type": "application/json" } })
    const init = fetchFn.mock.calls[0][1] as RequestInit | undefined
    const headers = init?.headers as Record<string, string> | undefined
    expect(headers?.["x-custom"]).toBe("yes")
    expect(headers?.["content-type"]).toBe("application/json")
    expect(headers?.authorization).toBe(`Bearer ${session.sessionToken}`)
  })

  it("lets the caller override the authorization header when explicitly provided", async () => {
    loadStoredSessionMock.mockReturnValue(session)
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: 1 }))
    vi.stubGlobal("fetch", fetchFn)
    await authedFetch("/x", { headers: { authorization: "Bearer override" } })
    const init = fetchFn.mock.calls[0][1] as RequestInit | undefined
    const headers = init?.headers as Record<string, string> | undefined
    expect(headers?.authorization).toBe("Bearer override")
  })

  it("throws AUTH_REQUIRED on 401", async () => {
    loadStoredSessionMock.mockReturnValue(null)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ success: false, error: "no" }, 401)))
    await expect(authedFetch("/x")).rejects.toThrow(AUTHED_FETCH_ERRORS.AUTH_REQUIRED)
  })

  it("throws RATE_LIMITED on 429", async () => {
    loadStoredSessionMock.mockReturnValue(null)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ success: false, error: "slow" }, 429)))
    await expect(authedFetch("/x")).rejects.toThrow(AUTHED_FETCH_ERRORS.RATE_LIMITED)
  })

  it("surfaces the server error message on 500 when present", async () => {
    loadStoredSessionMock.mockReturnValue(null)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ success: false, error: "boom" }, 500)))
    await expect(authedFetch("/x")).rejects.toThrow("boom")
  })

  it("falls back to REQUEST_FAILED on 500 with no body", async () => {
    loadStoredSessionMock.mockReturnValue(null)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 500 })))
    await expect(authedFetch("/x")).rejects.toThrow(AUTHED_FETCH_ERRORS.REQUEST_FAILED)
  })

  it("surfaces the server error message on 409 Already voted", async () => {
    loadStoredSessionMock.mockReturnValue(null)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: false, error: "Already voted" }, 409)),
    )
    await expect(authedFetch("/x")).rejects.toThrow("Already voted")
  })

  it("falls back to CONFLICT on 409 with no body", async () => {
    loadStoredSessionMock.mockReturnValue(null)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 409 })))
    await expect(authedFetch("/x")).rejects.toThrow(AUTHED_FETCH_ERRORS.CONFLICT)
  })

  it("exposes the error code constants", () => {
    expect(AUTHED_FETCH_ERRORS.AUTH_REQUIRED).toBe("AUTH_REQUIRED")
    expect(AUTHED_FETCH_ERRORS.RATE_LIMITED).toBe("RATE_LIMITED")
    expect(AUTHED_FETCH_ERRORS.REQUEST_FAILED).toBe("REQUEST_FAILED")
    expect(AUTHED_FETCH_ERRORS.CONFLICT).toBe("CONFLICT")
  })
})
