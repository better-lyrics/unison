import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { LinkView, type LinkViewModel } from "./LinkView"

afterEach(cleanup)

function dotsAreStatic(container: HTMLElement): boolean {
  const dots = container.querySelector(".link-pulse")
  if (!dots) throw new Error("no .link-pulse element rendered")
  return dots.classList.contains("link-pulse--static")
}

describe("LinkView", () => {
  it("renders the install copy", () => {
    render(<LinkView model={{ kind: "install" }} />)
    expect(screen.getByText(/install better lyrics first/i)).toBeTruthy()
    expect(screen.getByRole("link", { name: /get better lyrics/i })).toBeTruthy()
  })

  it("renders each outcome screen", () => {
    const noop = () => {}
    const cases: { model: LinkViewModel; text: RegExp }[] = [
      { model: { kind: "linked", name: "Alice" }, text: /you are all set/i },
      { model: { kind: "blocked" }, text: /cannot be linked/i },
      { model: { kind: "expired", onReset: noop }, text: /timed out/i },
      { model: { kind: "error", onReset: noop }, text: /something went wrong/i },
    ]
    for (const c of cases) {
      const { unmount } = render(<LinkView model={c.model} />)
      expect(screen.getByText(c.text)).toBeTruthy()
      unmount()
    }
  })

  describe("shimmer dots", () => {
    it("animates while loading", () => {
      const { container } = render(<LinkView model={{ kind: "loading" }} />)
      expect(dotsAreStatic(container)).toBe(false)
    })

    it("animates while connecting", () => {
      const { container } = render(
        <LinkView model={{ kind: "connect", connecting: true, error: null, onConnect: () => {} }} />,
      )
      expect(dotsAreStatic(container)).toBe(false)
    })

    it("is static on the idle connect prompt", () => {
      const { container } = render(
        <LinkView model={{ kind: "connect", connecting: false, error: null, onConnect: () => {} }} />,
      )
      expect(dotsAreStatic(container)).toBe(true)
    })

    it("is static on resolved states", () => {
      const { container } = render(<LinkView model={{ kind: "linked", name: null }} />)
      expect(dotsAreStatic(container)).toBe(true)
    })
  })
})
