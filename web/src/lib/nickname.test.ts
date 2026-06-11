import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { StoredSession } from "@/lib/auth"

const loadStoredSessionMock = vi.fn<() => StoredSession | null>()

vi.mock("@/lib/auth", () => ({
  loadStoredSession: () => loadStoredSessionMock(),
}))

let checkNicknameAvailability: typeof import("./nickname").checkNicknameAvailability
let putNickname: typeof import("./nickname").putNickname
let deleteNickname: typeof import("./nickname").deleteNickname

const session: StoredSession = {
  sessionToken: "abc.tok",
  keyId: "k".repeat(64),
  displayName: "BrightVivaceRoll",
  expiresAt: Math.floor(Date.now() / 1000) + 1000,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

beforeEach(async () => {
  loadStoredSessionMock.mockReset()
  loadStoredSessionMock.mockReturnValue(session)
  const mod = await import("./nickname")
  checkNicknameAvailability = mod.checkNicknameAvailability
  putNickname = mod.putNickname
  deleteNickname = mod.deleteNickname
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("checkNicknameAvailability", () => {
  it("POSTs /auth/nickname/check with the nickname in the JSON body and bearer token", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: { available: true } }))
    vi.stubGlobal("fetch", fetchFn)
    await checkNicknameAvailability("Alex 1")
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/auth/nickname/check")
    expect(init.method).toBe("POST")
    const headers = init.headers as Record<string, string>
    expect(headers["content-type"]).toBe("application/json")
    expect(headers.authorization).toBe(`Bearer ${session.sessionToken}`)
    expect(init.body).toBe(JSON.stringify({ nickname: "Alex 1" }))
  })

  it("returns { available: true } when the server reports unused", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ success: true, data: { available: true } })))
    await expect(checkNicknameAvailability("alex")).resolves.toEqual({ available: true })
  })

  it("returns SELF when the server reports the caller's own nickname", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ success: true, data: { available: true, reason: "SELF" } })))
    await expect(checkNicknameAvailability("alex")).resolves.toEqual({ available: true, reason: "SELF" })
  })

  it("returns TAKEN when the server reports a collision", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ success: true, data: { available: false, reason: "TAKEN" } })))
    await expect(checkNicknameAvailability("alex")).resolves.toEqual({ available: false, reason: "TAKEN" })
  })

  it("returns INVALID_FORMAT for a bad name", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ success: true, data: { available: false, reason: "INVALID_FORMAT" } })))
    await expect(checkNicknameAvailability("a b")).resolves.toEqual({
      available: false,
      reason: "INVALID_FORMAT",
    })
  })

  it("throws AUTH_REQUIRED on 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: false, error: "INVALID_TOKEN" }, 401)),
    )
    await expect(checkNicknameAvailability("alex")).rejects.toThrow("AUTH_REQUIRED")
  })

  it("throws RATE_LIMITED on 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: false, error: "RATE_LIMITED" }, 429)),
    )
    await expect(checkNicknameAvailability("alex")).rejects.toThrow("RATE_LIMITED")
  })
})

describe("putNickname", () => {
  it("PUTs /auth/nickname with a JSON body and bearer header", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, data: { keyId: session.keyId, displayName: "Alex" } }),
    )
    vi.stubGlobal("fetch", fetchFn)
    await putNickname("Alex")
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/auth/nickname")
    expect(init.method).toBe("PUT")
    const headers = init.headers as Record<string, string>
    expect(headers["content-type"]).toBe("application/json")
    expect(headers.authorization).toBe(`Bearer ${session.sessionToken}`)
    expect(JSON.parse(init.body as string)).toEqual({ nickname: "Alex" })
  })

  it("returns the envelope data on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ success: true, data: { keyId: session.keyId, displayName: "Alex" } }),
      ),
    )
    await expect(putNickname("Alex")).resolves.toEqual({
      keyId: session.keyId,
      displayName: "Alex",
    })
  })

  it("throws NICKNAME_TAKEN on 409", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: false, error: "NICKNAME_TAKEN" }, 409)),
    )
    await expect(putNickname("Alex")).rejects.toThrow("NICKNAME_TAKEN")
  })

  it("throws RATE_LIMITED on 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: false, error: "RATE_LIMITED" }, 429)),
    )
    await expect(putNickname("Alex")).rejects.toThrow("RATE_LIMITED")
  })

  it("throws AUTH_REQUIRED on 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: false, error: "INVALID_TOKEN" }, 401)),
    )
    await expect(putNickname("Alex")).rejects.toThrow("AUTH_REQUIRED")
  })

  it("throws INVALID_FORMAT on 400", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: false, error: "INVALID_FORMAT" }, 400)),
    )
    await expect(putNickname("a b")).rejects.toThrow("INVALID_FORMAT")
  })
})

describe("deleteNickname", () => {
  it("DELETEs /auth/nickname with no body and bearer header", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, data: { keyId: session.keyId, displayName: "Generated" } }),
    )
    vi.stubGlobal("fetch", fetchFn)
    await deleteNickname()
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/auth/nickname")
    expect(init.method).toBe("DELETE")
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe(`Bearer ${session.sessionToken}`)
    expect(init.body).toBeUndefined()
  })

  it("returns the envelope data on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ success: true, data: { keyId: session.keyId, displayName: "Generated" } }),
      ),
    )
    await expect(deleteNickname()).resolves.toEqual({
      keyId: session.keyId,
      displayName: "Generated",
    })
  })

  it("throws RATE_LIMITED on 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: false, error: "RATE_LIMITED" }, 429)),
    )
    await expect(deleteNickname()).rejects.toThrow("RATE_LIMITED")
  })

  it("throws AUTH_REQUIRED on 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: false, error: "INVALID_TOKEN" }, 401)),
    )
    await expect(deleteNickname()).rejects.toThrow("AUTH_REQUIRED")
  })
})
