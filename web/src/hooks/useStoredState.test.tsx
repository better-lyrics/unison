import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useStoredState } from "./useStoredState"

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe("useStoredState", () => {
  it("starts at the fallback and remembers a new value across mounts", () => {
    const first = renderHook(() => useStoredState<"on" | "off">("council.autoAdvance", "on"))
    expect(first.result.current[0]).toBe("on")
    act(() => first.result.current[1]("off"))
    expect(first.result.current[0]).toBe("off")
    first.unmount()
    const second = renderHook(() => useStoredState<"on" | "off">("council.autoAdvance", "on"))
    expect(second.result.current[0]).toBe("off")
  })

  describe("error paths", () => {
    it("falls back and keeps working in memory when storage throws", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("denied")
      })
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("denied")
      })
      const { result } = renderHook(() => useStoredState<string>("k", "a"))
      expect(result.current[0]).toBe("a")
      act(() => result.current[1]("b"))
      expect(result.current[0]).toBe("b")
    })
  })
})
