import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DocsPage } from "./DocsPage"

function renderPage() {
  return render(
    <MemoryRouter>
      <DocsPage />
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe("DocsPage", () => {
  it("documents the base URL and the primary fetch endpoint", () => {
    renderPage()
    expect(screen.getAllByText("https://unison.boidu.dev").length).toBeGreaterThan(0)
    expect(screen.getAllByText(/\/lyrics\?v=/).length).toBeGreaterThan(0)
  })

  it("documents search, variants, and single-id lookups", () => {
    renderPage()
    expect(screen.getAllByText(/\/lyrics\/search/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/\/lyrics\/variants\//).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/\/lyrics\/:id/).length).toBeGreaterThan(0)
  })

  it("no longer documents the legacy getLyrics endpoint", () => {
    renderPage()
    expect(screen.queryByText(/getLyrics/)).toBeNull()
  })

  it("offers the language tab set on every request example", () => {
    renderPage()
    // quickstart, song/artist, search, and variants each get a tab strip
    expect(screen.getAllByRole("tablist").length).toBeGreaterThanOrEqual(4)
    for (const lang of ["cURL", "JavaScript", "Python", "Go", "Rust"]) {
      expect(screen.getAllByRole("tab", { name: lang }).length).toBeGreaterThanOrEqual(4)
    }
  })

  it("switches a request example to the Python tab on click", () => {
    renderPage()
    fireEvent.click(screen.getAllByRole("tab", { name: "Python" })[0])
    expect(document.body.textContent).toContain("import requests")
  })

  it("keeps the language choice in sync across every code block", () => {
    renderPage()
    fireEvent.click(screen.getAllByRole("tab", { name: "Go" })[0])
    for (const tab of screen.getAllByRole("tab", { name: "Go" })) {
      expect(tab.getAttribute("aria-selected")).toBe("true")
    }
    for (const tab of screen.getAllByRole("tab", { name: "cURL" })) {
      expect(tab.getAttribute("aria-selected")).toBe("false")
    }
  })

  it("explains the three lyric formats", () => {
    renderPage()
    const body = document.body.textContent ?? ""
    expect(body).toContain("ttml")
    expect(body).toContain("lrc")
    expect(body).toContain("plain")
  })

  it("copies the quickstart example to the clipboard", () => {
    renderPage()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    const copyButtons = screen.getAllByRole("button", { name: /copy/i })
    fireEvent.click(copyButtons[0])
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0][0]).toContain("unison.boidu.dev/lyrics")
  })
})
