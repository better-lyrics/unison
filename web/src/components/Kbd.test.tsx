import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { Kbd } from "./Kbd"

afterEach(cleanup)

describe("Kbd", () => {
  it("renders one badge per key", () => {
    const { container } = render(<Kbd keys={["Mod", "Enter"]} isMac />)
    expect(container.querySelectorAll("span > span")).toHaveLength(2)
  })

  it("renders the command icon for Mod on macOS", () => {
    const { container } = render(<Kbd keys={["Mod"]} isMac />)
    expect(container.querySelector("svg")).toBeTruthy()
  })

  it("renders the word Ctrl for Mod off macOS", () => {
    const { container } = render(<Kbd keys={["Mod"]} isMac={false} />)
    expect(container.querySelector("svg")).toBeNull()
    expect(container.textContent).toBe("Ctrl")
  })

  it("renders the formatted symbol for a named key", () => {
    const { container } = render(<Kbd keys={["Shift"]} isMac />)
    expect(container.textContent).toBe("⇧")
  })
})

describe("placement", () => {
  it("regression: takes colour and spacing on its own flex root, so no inline wrapper shifts it off centre", () => {
    const { container } = render(<Kbd keys={["/"]} className="ml-auto text-unison-text-muted" />)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain("inline-flex")
    expect(root.className).toContain("ml-auto")
    expect(root.className).toContain("text-unison-text-muted")
  })

  it("keeps the base layout without a class", () => {
    const { container } = render(<Kbd keys={["K"]} />)
    expect((container.firstElementChild as HTMLElement).className).toBe("inline-flex items-center gap-0.5")
  })
})
