import { QueryClient, useQueryClient } from "@tanstack/react-query"
import { render, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { createQueryClient, QueryProvider } from "./queryClient"

describe("createQueryClient", () => {
  it("returns a QueryClient with the spec defaults", () => {
    const client = createQueryClient()
    expect(client).toBeInstanceOf(QueryClient)
    const defaults = client.getDefaultOptions()
    expect(defaults.queries?.staleTime).toBe(30_000)
    expect(defaults.queries?.gcTime).toBe(5 * 60_000)
    expect(defaults.queries?.retry).toBe(1)
  })
})

describe("QueryProvider", () => {
  it("renders children", () => {
    const { getByTestId } = render(
      <QueryProvider>
        <div data-testid="child">hello</div>
      </QueryProvider>,
    )
    expect(getByTestId("child").textContent).toBe("hello")
  })

  it("uses an injected client when provided", () => {
    const injected = createQueryClient()
    const { result } = renderHook(() => useQueryClient(), {
      wrapper: ({ children }) => <QueryProvider client={injected}>{children}</QueryProvider>,
    })
    expect(result.current).toBe(injected)
  })

  it("constructs its own client when none is provided", () => {
    const { result } = renderHook(() => useQueryClient(), {
      wrapper: ({ children }) => <QueryProvider>{children}</QueryProvider>,
    })
    expect(result.current).toBeInstanceOf(QueryClient)
  })
})
