import { describe, expect, it } from "vitest"
import { toHandle } from "./handle"

describe("toHandle", () => {
  it("lowercases and strips spaces", () => {
    expect(toHandle("Aurora Wynter")).toBe("aurorawynter")
  })

  it("keeps underscores and digits", () => {
    expect(toHandle("Node_9")).toBe("node_9")
  })

  describe("edge cases", () => {
    it("drops punctuation and diacritic-free symbols", () => {
      expect(toHandle("D.J! Quill-42")).toBe("djquill42")
    })

    it("returns an empty string when nothing survives", () => {
      expect(toHandle("★ ☆ ✦")).toBe("")
    })
  })

  describe("invariants", () => {
    it("is idempotent", () => {
      const once = toHandle("Aurora Wynter")
      expect(toHandle(once)).toBe(once)
    })
  })
})
