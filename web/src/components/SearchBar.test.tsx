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

function renderBar(initialEntries: string[] = ["/"], extraProps: Partial<{ compact: boolean }> = {}) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <SearchBar {...extraProps} />
      <LocationProbe />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe("SearchBar", () => {
  it("renders an empty searchbox when not on /search", () => {
    renderBar(["/"])
    const input = screen.getByRole("searchbox", { name: /search lyrics/i }) as HTMLInputElement
    expect(input.value).toBe("")
  })

  it("pre-fills the value from the q query param when on /search", () => {
    renderBar(["/search?q=midnight"])
    const input = screen.getByRole("searchbox", { name: /search lyrics/i }) as HTMLInputElement
    expect(input.value).toBe("midnight")
  })

  it("uses type=search and an accessible label", () => {
    renderBar(["/"])
    const input = screen.getByRole("searchbox", { name: /search lyrics/i }) as HTMLInputElement
    expect(input.getAttribute("type")).toBe("search")
    expect(input.getAttribute("aria-label")).toBe("Search lyrics")
  })

  it("does not change the URL when typing on a non-/search route", () => {
    renderBar(["/"])
    const input = screen.getByRole("searchbox", { name: /search lyrics/i })
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
    const input = screen.getByRole("searchbox", { name: /search lyrics/i })
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
    const input = screen.getByRole("searchbox", { name: /search lyrics/i })
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
    const input = screen.getByRole("searchbox", { name: /search lyrics/i })
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" })
    })
    const probe = screen.getByTestId("location")
    expect(probe.getAttribute("data-pathname")).toBe("/")
  })

  it("does not navigate when Enter is pressed with fewer than 2 characters", () => {
    renderBar(["/"])
    const input = screen.getByRole("searchbox", { name: /search lyrics/i })
    act(() => {
      fireEvent.change(input, { target: { value: "a" } })
    })
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" })
    })
    const probe = screen.getByTestId("location")
    expect(probe.getAttribute("data-pathname")).toBe("/")
  })

  it("clears the value and blurs the input on Escape", () => {
    renderBar(["/search?q=foo"])
    const input = screen.getByRole("searchbox", { name: /search lyrics/i }) as HTMLInputElement
    input.focus()
    expect(document.activeElement).toBe(input)
    act(() => {
      fireEvent.keyDown(input, { key: "Escape" })
    })
    expect(input.value).toBe("")
    expect(document.activeElement).not.toBe(input)
  })

  it("encodes special characters in the q param when navigating on Enter", () => {
    renderBar(["/"])
    const input = screen.getByRole("searchbox", { name: /search lyrics/i })
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
    expect(screen.queryByRole("searchbox", { name: /search lyrics/i })).toBeNull()
    const toggle = screen.getByRole("button", { name: /open search/i })
    act(() => {
      toggle.click()
    })
    expect(screen.getByRole("searchbox", { name: /search lyrics/i })).toBeTruthy()
  })

  it("reflects external q changes back into the input when on /search", () => {
    render(
      <MemoryRouter initialEntries={["/search?q=neon"]}>
        <SearchBar />
        <ExternalQSetter value="summer" />
        <LocationProbe />
      </MemoryRouter>,
    )
    const input = screen.getByRole("searchbox", { name: /search lyrics/i }) as HTMLInputElement
    expect(input.value).toBe("neon")

    act(() => {
      screen.getByTestId("set-q").click()
    })

    expect(input.value).toBe("summer")
  })
})
