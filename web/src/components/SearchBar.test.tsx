import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter, useLocation, useSearchParams } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SearchBar } from "./SearchBar"

function LocationProbe() {
  const location = useLocation()
  return (
    <div data-testid="location" data-pathname={location.pathname} data-search={location.search}>
      {`${location.pathname}${location.search}`}
    </div>
  )
}

function ExternalQSetter({ value }: { value: string }) {
  const [, setSearchParams] = useSearchParams()
  return (
    <button
      type="button"
      data-testid="set-q"
      onClick={() => {
        setSearchParams({ q: value })
      }}
    >
      set q
    </button>
  )
}

function createTestClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } } })
}

function renderBar(initialEntries: string[] = ["/"], extraProps: Partial<{ compact: boolean }> = {}) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={createTestClient()}>
        <SearchBar {...extraProps} />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })),
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  cleanup()
})

describe("SearchBar", () => {
  it("renders an empty searchbox when not on /search", () => {
    renderBar(["/"])
    const input = screen.getByRole("combobox", { name: /search lyrics/i }) as HTMLInputElement
    expect(input.value).toBe("")
  })

  it("pre-fills the value from the q query param when on /search", () => {
    renderBar(["/search?q=midnight"])
    const input = screen.getByRole("combobox", { name: /search lyrics/i }) as HTMLInputElement
    expect(input.value).toBe("midnight")
  })

  it("uses type=search and an accessible label", () => {
    renderBar(["/"])
    const input = screen.getByRole("combobox", { name: /search lyrics/i }) as HTMLInputElement
    expect(input.getAttribute("type")).toBe("search")
    expect(input.getAttribute("aria-label")).toBe("Search lyrics")
  })

  it("does not change the URL when typing on a non-/search route", () => {
    renderBar(["/"])
    const input = screen.getByRole("combobox", { name: /search lyrics/i })
    act(() => {
      fireEvent.change(input, { target: { value: "love" } })
    })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    const probe = screen.getByTestId("location")
    expect(probe.getAttribute("data-pathname")).toBe("/")
    expect(probe.getAttribute("data-search")).toBe("")
  })

  it("updates the URL q param after the 200ms debounce when on /search", () => {
    renderBar(["/search?q=old"])
    const input = screen.getByRole("combobox", { name: /search lyrics/i })
    act(() => {
      fireEvent.change(input, { target: { value: "midnight" } })
    })
    act(() => {
      vi.advanceTimersByTime(199)
    })
    let probe = screen.getByTestId("location")
    expect(probe.getAttribute("data-search")).toBe("?q=old")

    act(() => {
      vi.advanceTimersByTime(1)
    })
    probe = screen.getByTestId("location")
    expect(probe.getAttribute("data-search")).toBe("?q=midnight")
  })

  it("navigates to /search?q=... when Enter is pressed with a non-empty value", () => {
    renderBar(["/"])
    const input = screen.getByRole("combobox", { name: /search lyrics/i })
    act(() => {
      fireEvent.change(input, { target: { value: "neon" } })
    })
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" })
    })
    const probe = screen.getByTestId("location")
    expect(probe.getAttribute("data-pathname")).toBe("/search")
    expect(probe.getAttribute("data-search")).toBe("?q=neon")
  })

  it("does not navigate when Enter is pressed with an empty value", () => {
    renderBar(["/"])
    const input = screen.getByRole("combobox", { name: /search lyrics/i })
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" })
    })
    const probe = screen.getByTestId("location")
    expect(probe.getAttribute("data-pathname")).toBe("/")
  })

  it("does not navigate when Enter is pressed with fewer than 2 characters", () => {
    renderBar(["/"])
    const input = screen.getByRole("combobox", { name: /search lyrics/i })
    act(() => {
      fireEvent.change(input, { target: { value: "a" } })
    })
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" })
    })
    const probe = screen.getByTestId("location")
    expect(probe.getAttribute("data-pathname")).toBe("/")
  })

  it("closes the dropdown on the first Escape, then clears and blurs on the second", () => {
    renderBar(["/search?q=foo"])
    const input = screen.getByRole("combobox", { name: /search lyrics/i }) as HTMLInputElement
    act(() => {
      input.focus()
    })
    expect(document.activeElement).toBe(input)

    act(() => {
      fireEvent.keyDown(input, { key: "Escape" })
    })
    expect(input.value).toBe("foo")
    expect(document.activeElement).toBe(input)

    act(() => {
      fireEvent.keyDown(input, { key: "Escape" })
    })
    expect(input.value).toBe("")
    expect(document.activeElement).not.toBe(input)
  })

  it("encodes special characters in the q param when navigating on Enter", () => {
    renderBar(["/"])
    const input = screen.getByRole("combobox", { name: /search lyrics/i })
    act(() => {
      fireEvent.change(input, { target: { value: "rock & roll" } })
    })
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" })
    })
    const probe = screen.getByTestId("location")
    expect(probe.getAttribute("data-search")).toBe("?q=rock%20%26%20roll")
  })

  it("expands the bar from icon-only when compact and the toggle is clicked", () => {
    renderBar(["/"], { compact: true })
    expect(screen.queryByRole("combobox", { name: /search lyrics/i })).toBeNull()
    const toggle = screen.getByRole("button", { name: /open search/i })
    act(() => {
      toggle.click()
    })
    expect(screen.getByRole("combobox", { name: /search lyrics/i })).toBeTruthy()
  })

  it("keeps the close button visible after typing in the compact, expanded bar", () => {
    renderBar(["/"], { compact: true })
    act(() => {
      screen.getByRole("button", { name: /open search/i }).click()
    })
    const input = screen.getByRole("combobox", { name: /search lyrics/i })
    act(() => {
      fireEvent.change(input, { target: { value: "neon" } })
    })
    expect(screen.getByRole("button", { name: /close search/i })).toBeTruthy()
  })

  it("clears the value and collapses back to icon-only when the close button is clicked", () => {
    renderBar(["/"], { compact: true })
    act(() => {
      screen.getByRole("button", { name: /open search/i }).click()
    })
    const input = screen.getByRole("combobox", { name: /search lyrics/i }) as HTMLInputElement
    act(() => {
      fireEvent.change(input, { target: { value: "neon" } })
    })
    expect(input.value).toBe("neon")

    act(() => {
      screen.getByRole("button", { name: /close search/i }).click()
    })

    expect(screen.queryByRole("combobox", { name: /search lyrics/i })).toBeNull()
    expect(screen.getByRole("button", { name: /open search/i })).toBeTruthy()

    act(() => {
      screen.getByRole("button", { name: /open search/i }).click()
    })
    const reopened = screen.getByRole("combobox", { name: /search lyrics/i }) as HTMLInputElement
    expect(reopened.value).toBe("")
  })

  it("reflects external q changes back into the input when on /search", () => {
    render(
      <MemoryRouter initialEntries={["/search?q=neon"]}>
        <QueryClientProvider client={createTestClient()}>
          <SearchBar />
          <ExternalQSetter value="summer" />
          <LocationProbe />
        </QueryClientProvider>
      </MemoryRouter>,
    )
    const input = screen.getByRole("combobox", { name: /search lyrics/i }) as HTMLInputElement
    expect(input.value).toBe("neon")

    act(() => {
      screen.getByTestId("set-q").click()
    })

    expect(input.value).toBe("summer")
  })

  it("does not stomp the URL back to the previous q when the URL changes externally", () => {
    render(
      <MemoryRouter initialEntries={["/search?q=neon"]}>
        <QueryClientProvider client={createTestClient()}>
          <SearchBar />
          <ExternalQSetter value="summer" />
          <LocationProbe />
        </QueryClientProvider>
      </MemoryRouter>,
    )
    const input = screen.getByRole("combobox", { name: /search lyrics/i }) as HTMLInputElement
    expect(input.value).toBe("neon")

    act(() => {
      screen.getByTestId("set-q").click()
    })

    expect(input.value).toBe("summer")
    let probe = screen.getByTestId("location")
    expect(probe.getAttribute("data-pathname")).toBe("/search")
    expect(probe.getAttribute("data-search")).toBe("?q=summer")

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(input.value).toBe("summer")
    probe = screen.getByTestId("location")
    expect(probe.getAttribute("data-pathname")).toBe("/search")
    expect(probe.getAttribute("data-search")).toBe("?q=summer")
  })

  it("pushes the typed query to the URL after an external URL change", () => {
    render(
      <MemoryRouter initialEntries={["/search?q=neon"]}>
        <QueryClientProvider client={createTestClient()}>
          <SearchBar />
          <ExternalQSetter value="summer" />
          <LocationProbe />
        </QueryClientProvider>
      </MemoryRouter>,
    )
    const input = screen.getByRole("combobox", { name: /search lyrics/i }) as HTMLInputElement

    act(() => {
      screen.getByTestId("set-q").click()
    })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(input.value).toBe("summer")
    expect(screen.getByTestId("location").getAttribute("data-search")).toBe("?q=summer")

    act(() => {
      fireEvent.change(input, { target: { value: "winter" } })
    })
    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(input.value).toBe("winter")
    expect(screen.getByTestId("location").getAttribute("data-search")).toBe("?q=winter")
  })
})
