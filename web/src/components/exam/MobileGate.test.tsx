import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MobileGate } from "./MobileGate"

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe("MobileGate", () => {
  it("renders the exam on a wide viewport", () => {
    stubMatchMedia(false)
    const { container } = render(
      <MobileGate>
        <div>exam content</div>
      </MobileGate>,
    )
    expect(screen.getByText("exam content")).toBeTruthy()
    expect(container.querySelector("img")).toBeNull()
  })

  it("blocks a narrow viewport with a gif roast and hides the exam", () => {
    stubMatchMedia(true)
    const { container } = render(
      <MobileGate>
        <div>exam content</div>
      </MobileGate>,
    )
    expect(screen.queryByText("exam content")).toBeNull()
    const gif = container.querySelector("img") as HTMLImageElement | null
    expect(gif?.getAttribute("src")).toMatch(/^https:\/\/cdn\.betterlyrics\.org\/.+\.gif$/)
    expect(screen.getByText(/needs a desktop/i)).toBeTruthy()
  })
})
