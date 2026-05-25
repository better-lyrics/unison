import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { clearAsyncDataCache, useAsyncData } from "./useAsyncData"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("useAsyncData", () => {
  it("transitions from loading to success", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true })
    const { result } = renderHook(() => useAsyncData(fetcher))
    expect(result.current.status).toBe("loading")
    await waitFor(() => expect(result.current.status).toBe("success"))
    expect(result.current.data).toEqual({ ok: true })
  })

  it("captures errors", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("boom"))
    const { result } = renderHook(() => useAsyncData(fetcher))
    await waitFor(() => expect(result.current.status).toBe("error"))
    expect(result.current.error?.message).toBe("boom")
  })
})

describe("useAsyncData cache", () => {
  beforeEach(() => {
    clearAsyncDataCache()
  })
  afterEach(() => {
    clearAsyncDataCache()
  })

  it("renders cached data immediately on mount, then revalidates", async () => {
    const first = vi.fn().mockResolvedValue({ value: 1 })
    const { result: r1, unmount } = renderHook(() => useAsyncData(first, "k"))
    await waitFor(() => expect(r1.current.status).toBe("success"))
    expect(r1.current.data).toEqual({ value: 1 })
    unmount()

    const second = vi.fn().mockResolvedValue({ value: 2 })
    const { result: r2 } = renderHook(() => useAsyncData(second, "k"))
    expect(r2.current.status).toBe("success")
    expect(r2.current.data).toEqual({ value: 1 })
    await waitFor(() => expect(r2.current.data).toEqual({ value: 2 }))
    expect(second).toHaveBeenCalledTimes(1)
  })

  it("keeps cached data on revalidation error and logs to console", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const first = vi.fn().mockResolvedValue({ value: "cached" })
    const { result: r1, unmount } = renderHook(() => useAsyncData(first, "k2"))
    await waitFor(() => expect(r1.current.status).toBe("success"))
    unmount()

    const second = vi.fn().mockRejectedValue(new Error("network down"))
    const { result: r2 } = renderHook(() => useAsyncData(second, "k2"))
    expect(r2.current.status).toBe("success")
    expect(r2.current.data).toEqual({ value: "cached" })
    await waitFor(() => expect(second).toHaveBeenCalled())
    await waitFor(() => expect(consoleError).toHaveBeenCalled())
    expect(r2.current.status).toBe("success")
    expect(r2.current.data).toEqual({ value: "cached" })
  })

  it("clearAsyncDataCache wipes the cache", async () => {
    const first = vi.fn().mockResolvedValue({ value: "x" })
    const { result: r1, unmount } = renderHook(() => useAsyncData(first, "k3"))
    await waitFor(() => expect(r1.current.status).toBe("success"))
    unmount()

    clearAsyncDataCache()

    const second = vi.fn().mockResolvedValue({ value: "y" })
    const { result: r2 } = renderHook(() => useAsyncData(second, "k3"))
    expect(r2.current.status).toBe("loading")
    await waitFor(() => expect(r2.current.status).toBe("success"))
    expect(r2.current.data).toEqual({ value: "y" })
  })
})
