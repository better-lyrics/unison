import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { usePreviewClock } from "./usePreviewClock"

let now = 0

beforeEach(() => {
  now = 1000
  vi.spyOn(performance, "now").mockImplementation(() => now)
})
afterEach(() => vi.restoreAllMocks())

describe("usePreviewClock", () => {
  it("holds at the start time until played, then runs in real time", () => {
    const { result } = renderHook(() => usePreviewClock(12.4))
    expect(result.current.getCurrentTime()).toBe(12.4)
    expect(result.current.getPlaying()).toBe(false)
    act(() => result.current.toggle())
    now += 2500
    expect(result.current.playing).toBe(true)
    expect(result.current.getPlaying()).toBe(true)
    expect(result.current.getCurrentTime()).toBeCloseTo(14.9)
  })

  it("pauses where it is and resumes from there", () => {
    const { result } = renderHook(() => usePreviewClock(0))
    act(() => result.current.toggle())
    now += 3000
    act(() => result.current.toggle())
    now += 10_000
    expect(result.current.getCurrentTime()).toBeCloseTo(3)
    act(() => result.current.toggle())
    now += 1000
    expect(result.current.getCurrentTime()).toBeCloseTo(4)
  })

  describe("edge cases", () => {
    it("goes back to the start and stops when the start time changes", () => {
      const { result, rerender } = renderHook(({ start }) => usePreviewClock(start), { initialProps: { start: 5 } })
      act(() => result.current.toggle())
      now += 4000
      rerender({ start: 30 })
      expect(result.current.playing).toBe(false)
      expect(result.current.getCurrentTime()).toBe(30)
    })
  })

  describe("invariants", () => {
    it("keeps the same getter functions across renders so the renderer loop is not restarted", () => {
      const { result, rerender } = renderHook(() => usePreviewClock(0))
      const first = result.current
      act(() => result.current.toggle())
      rerender()
      expect(result.current.getCurrentTime).toBe(first.getCurrentTime)
      expect(result.current.getPlaying).toBe(first.getPlaying)
    })
  })
})
