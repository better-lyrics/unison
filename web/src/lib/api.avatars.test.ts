import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fetchAvatarCatalogue, putAvatar } from "./api"
import { saveStoredSession } from "./auth"
import { AUTHED_FETCH_ERRORS } from "./authedFetch"

const catalogue = {
  presets: [{ id: "alien-cat", label: "Alien Cat", url: "https://cdn.betterlyrics.org/avatars/alien-cat.webp" }],
  display: { cdnBase: "https://cdn.betterlyrics.org/avatars/" },
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

beforeEach(() => {
  localStorage.clear()
  saveStoredSession({ sessionToken: "tok", keyId: "k".repeat(64), displayName: "Kay", expiresAt: 9_999_999_999 })
})
afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe("fetchAvatarCatalogue", () => {
  it("reads the preset catalogue from /avatars", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ success: true, data: catalogue }))
    vi.stubGlobal("fetch", fetchMock)
    expect(await fetchAvatarCatalogue()).toEqual(catalogue)
    expect(String(fetchMock.mock.calls[0][0])).toBe("/avatars")
  })
})

describe("putAvatar", () => {
  it("PUTs the choice with the session bearer and returns the resolved url", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ success: true, data: { avatarUrl: catalogue.presets[0].url } }))
    vi.stubGlobal("fetch", fetchMock)

    const res = await putAvatar({ type: "preset", ref: "alien-cat" })

    expect(res.avatarUrl).toBe(catalogue.presets[0].url)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/avatars/me")
    expect(init.method).toBe("PUT")
    expect(JSON.parse(String(init.body))).toEqual({ type: "preset", ref: "alien-cat" })
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok")
  })

  it("returns null when the choice is cleared to the default", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ success: true, data: { avatarUrl: null } })))
    expect((await putAvatar({ type: "default" })).avatarUrl).toBeNull()
  })

  describe("error paths", () => {
    it("surfaces a rate limit", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ success: false, error: "RATE_LIMITED" }, 429)))
      await expect(putAvatar({ type: "default" })).rejects.toThrow(AUTHED_FETCH_ERRORS.RATE_LIMITED)
    })

    it("surfaces a missing Discord photo as a conflict", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(json({ success: false, error: "DISCORD_AVATAR_UNAVAILABLE" }, 409)),
      )
      await expect(putAvatar({ type: "discord" })).rejects.toThrow()
    })
  })
})
