import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useAsyncData } from "./useAsyncData"

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
