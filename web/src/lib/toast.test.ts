import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { __resetToastStore, dismissToast, pushToast, useToasts } from "./toast"

beforeEach(() => {
  __resetToastStore()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  __resetToastStore()
})

describe("toast store", () => {
  it("pushToast adds a toast with a stable id", () => {
    const id = pushToast({ kind: "info", message: "hello" })
    expect(typeof id).toBe("string")
    expect(id.length).toBeGreaterThan(0)
  })

  it("pushToast auto-dismisses info toasts after 3000ms by default", () => {
    const { result } = renderHook(() => useToasts())
    act(() => {
      pushToast({ kind: "info", message: "hi" })
    })
    expect(result.current).toHaveLength(1)
    act(() => {
      vi.advanceTimersByTime(2999)
    })
    expect(result.current).toHaveLength(1)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toHaveLength(0)
  })

  it("auto-dismisses success toasts after 3000ms by default", () => {
    const { result } = renderHook(() => useToasts())
    act(() => {
      pushToast({ kind: "success", message: "done" })
    })
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(result.current).toHaveLength(0)
  })

  it("auto-dismisses error toasts after 5000ms by default", () => {
    const { result } = renderHook(() => useToasts())
    act(() => {
      pushToast({ kind: "error", message: "boom" })
    })
    act(() => {
      vi.advanceTimersByTime(4999)
    })
    expect(result.current).toHaveLength(1)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toHaveLength(0)
  })

  it("respects a custom durationMs", () => {
    const { result } = renderHook(() => useToasts())
    act(() => {
      pushToast({ kind: "info", message: "x", durationMs: 100 })
    })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(result.current).toHaveLength(0)
  })

  it("dismissToast removes a toast immediately", () => {
    const { result } = renderHook(() => useToasts())
    let id = ""
    act(() => {
      id = pushToast({ kind: "info", message: "x" })
    })
    expect(result.current).toHaveLength(1)
    act(() => {
      dismissToast(id)
    })
    expect(result.current).toHaveLength(0)
  })

  it("dismissToast on an unknown id is a no-op", () => {
    const { result } = renderHook(() => useToasts())
    act(() => {
      pushToast({ kind: "info", message: "x" })
    })
    expect(result.current).toHaveLength(1)
    act(() => {
      dismissToast("nope")
    })
    expect(result.current).toHaveLength(1)
  })

  it("useToasts subscribes and re-renders when the store changes", () => {
    const { result } = renderHook(() => useToasts())
    expect(result.current).toHaveLength(0)
    act(() => {
      pushToast({ kind: "info", message: "one" })
    })
    expect(result.current).toHaveLength(1)
    act(() => {
      pushToast({ kind: "error", message: "two" })
    })
    expect(result.current).toHaveLength(2)
    expect(result.current[0]?.message).toBe("one")
    expect(result.current[1]?.message).toBe("two")
  })

  it("each push returns a unique id", () => {
    const a = pushToast({ kind: "info", message: "a" })
    const b = pushToast({ kind: "info", message: "b" })
    expect(a).not.toBe(b)
  })
})
