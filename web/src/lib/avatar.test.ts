import { describe, expect, it } from "vitest"
import { dicebearThumbsDataUri } from "./avatar"

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
