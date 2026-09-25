import { describe, expect, it } from "vitest"
import { dicebearThumbsDataUri, resolveAvatar } from "./avatar"

describe("dicebearThumbsDataUri", () => {
  it("returns a data URI that round-trips the seed", () => {
    const a = dicebearThumbsDataUri("a".repeat(64))
    const b = dicebearThumbsDataUri("a".repeat(64))
    expect(a).toBe(b)
    expect(a.startsWith("data:image/svg+xml")).toBe(true)
  })

  it("produces different output for different seeds", () => {
    const a = dicebearThumbsDataUri("a".repeat(64))
    const b = dicebearThumbsDataUri("b".repeat(64))
    expect(a).not.toBe(b)
  })
})

describe("resolveAvatar", () => {
  const keyId = "a".repeat(64)

  it("returns the server url when one is chosen", () => {
    const url = "https://cdn.betterlyrics.org/avatars/alien-cat.webp"
    expect(resolveAvatar({ avatarUrl: url, keyId })).toBe(url)
  })

  it("falls back to the generated thumb when the url is null", () => {
    expect(resolveAvatar({ avatarUrl: null, keyId })).toBe(dicebearThumbsDataUri(keyId))
  })

  describe("edge cases", () => {
    it("falls back when the field is absent (older cached payloads)", () => {
      expect(resolveAvatar({ keyId })).toBe(dicebearThumbsDataUri(keyId))
    })

    it("falls back when the url is an empty string", () => {
      expect(resolveAvatar({ avatarUrl: "", keyId })).toBe(dicebearThumbsDataUri(keyId))
    })
  })
})
