import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearStoredSession,
  fetchChallenge,
  fetchMe,
  loadStoredSession,
  postSession,
  saveStoredSession,
  STORAGE_KEY,
  type StoredSession,
} from "./auth"

const valid: StoredSession = {
  sessionToken: "tok-abc",
  keyId: "k".repeat(64),
  displayName: "BrightVivaceRoll",
  expiresAt: Math.floor(Date.now() / 1000) + 1000,
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})
afterEach(() => {
  localStorage.clear()
})

describe("session storage", () => {
  it("round-trips a valid session", () => {
    saveStoredSession(valid)
    expect(loadStoredSession()).toEqual(valid)
  })

  it("returns null when nothing is stored", () => {
    expect(loadStoredSession()).toBeNull()
  })

  it("returns null and wipes the slot when stored value is malformed", () => {
    localStorage.setItem(STORAGE_KEY, "{not json")
    expect(loadStoredSession()).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it("returns null and wipes the slot when stored session is expired", () => {
    saveStoredSession({ ...valid, expiresAt: Math.floor(Date.now() / 1000) - 1 })
    expect(loadStoredSession()).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it("clearStoredSession removes the slot", () => {
    saveStoredSession(valid)
    clearStoredSession()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

describe("fetchChallenge", () => {
  it("returns nonce + expiresAt on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { nonce: "n1", expiresAt: 99 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ))
    await expect(fetchChallenge()).resolves.toEqual({ nonce: "n1", expiresAt: 99 })
  })

  it("throws when the envelope reports failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: "boom" }), { status: 200 }),
    ))
    await expect(fetchChallenge()).rejects.toThrow("boom")
  })
})

describe("postSession", () => {
  it("posts the signed body and returns the session payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: valid }), { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const signedBody = { payload: { nonce: "n" }, signature: "s", publicKey: { kty: "EC" } }
    await expect(postSession(signedBody)).resolves.toEqual(valid)
    expect(fetchMock).toHaveBeenCalledWith(
      "/auth/session",
      expect.objectContaining({ method: "POST" }),
    )
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(init.body as string)).toEqual(signedBody)
  })

  it("surfaces envelope errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: "CHALLENGE_INVALID" }), { status: 401 }),
    ))
    const signedBody = { payload: {}, signature: "", publicKey: {} }
    await expect(postSession(signedBody)).rejects.toThrow("CHALLENGE_INVALID")
  })
})

describe("fetchMe", () => {
  it("returns the identity for a valid token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { keyId: valid.keyId, displayName: valid.displayName, expiresAt: valid.expiresAt },
        }),
        { status: 200 },
      ),
    ))
    await expect(fetchMe("tok")).resolves.toEqual({
      keyId: valid.keyId,
      displayName: valid.displayName,
      expiresAt: valid.expiresAt,
    })
  })

  it("surfaces envelope.error for a 401 with a JSON envelope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: "INVALID_TOKEN" }), { status: 401 }),
    ))
    await expect(fetchMe("bad")).rejects.toThrow("INVALID_TOKEN")
  })

  it("throws HTTP <status> when a failure response has no JSON envelope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("<html>502</html>", { status: 502, headers: { "content-type": "text/html" } }),
    ))
    await expect(fetchMe("anything")).rejects.toThrow("HTTP 502")
  })

  it("throws HTTP <status> when a 5xx returns JSON without a success/error envelope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Bad Gateway" }), {
        status: 502,
        headers: { "content-type": "application/json" },
      }),
    ))
    await expect(fetchMe("anything")).rejects.toThrow("HTTP 502")
  })
})

describe("network failure propagation", () => {
  it("fetchChallenge propagates a fetch rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))
    await expect(fetchChallenge()).rejects.toThrow("Failed to fetch")
  })
  it("postSession propagates a fetch rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))
    await expect(postSession({ payload: {}, signature: "", publicKey: {} })).rejects.toThrow("Failed to fetch")
  })
  it("fetchMe propagates a fetch rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))
    await expect(fetchMe("tok")).rejects.toThrow("Failed to fetch")
  })
})
