import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useDebouncedValue } from "./useDebouncedValue"

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("useDebouncedValue", () => {
  it("returns the initial value on first render", () => {
    const { result } = renderHook(() => useDebouncedValue("hello", 200))
    expect(result.current).toBe("hello")
  })

  it("emits only the latest value after the delay elapses", () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 200), {
      initialProps: { value: "a" },
    })
    expect(result.current).toBe("a")

    rerender({ value: "b" })
    rerender({ value: "c" })
    rerender({ value: "d" })

    act(() => {
      vi.advanceTimersByTime(199)
    })
    expect(result.current).toBe("a")

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe("d")
  })

  it("resets the timer on every value change", () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 200), {
      initialProps: { value: "a" },
    })
    rerender({ value: "b" })
    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(result.current).toBe("a")
    rerender({ value: "c" })
    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(result.current).toBe("a")
    act(() => {
      vi.advanceTimersByTime(50)
    })
    expect(result.current).toBe("c")
  })

  it("does not throw or leak when unmounted before the delay elapses", () => {
    const { rerender, unmount } = renderHook(({ value }) => useDebouncedValue(value, 200), {
      initialProps: { value: "a" },
    })
    rerender({ value: "b" })
    expect(() => {
      unmount()
      vi.advanceTimersByTime(500)
    }).not.toThrow()
  })
})
