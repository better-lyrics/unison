import { describe, expect, it } from "vitest"
import { formatKey } from "./format-key"

describe("formatKey", () => {
  describe("macOS", () => {
    it("maps modifier keys to macOS symbols", () => {
      expect(formatKey("Mod", true)).toBe("⌘")
      expect(formatKey("Meta", true)).toBe("⌘")
      expect(formatKey("Ctrl", true)).toBe("⌃")
      expect(formatKey("Alt", true)).toBe("⌥")
    })
  })

  describe("non-macOS", () => {
    it("maps modifier keys to word forms", () => {
      expect(formatKey("Mod", false)).toBe("Ctrl")
      expect(formatKey("Meta", false)).toBe("Meta")
      expect(formatKey("Ctrl", false)).toBe("Ctrl")
      expect(formatKey("Alt", false)).toBe("Alt")
    })
  })

  describe("platform-independent keys", () => {
    it("maps named keys to symbols the same on every platform", () => {
      expect(formatKey("Shift", true)).toBe("⇧")
      expect(formatKey("Shift", false)).toBe("⇧")
      expect(formatKey("Enter", true)).toBe("↵")
      expect(formatKey("Escape", true)).toBe("Esc")
      expect(formatKey("Space", true)).toBe("Space")
      expect(formatKey("ArrowUp", true)).toBe("↑")
      expect(formatKey("ArrowDown", true)).toBe("↓")
      expect(formatKey("ArrowLeft", true)).toBe("←")
      expect(formatKey("ArrowRight", true)).toBe("→")
    })
  })

  describe("edge cases", () => {
    it("passes through an unmapped key unchanged", () => {
      expect(formatKey("/", true)).toBe("/")
      expect(formatKey("A", false)).toBe("A")
    })

    it("passes through an empty string", () => {
      expect(formatKey("", true)).toBe("")
    })
  })
})
