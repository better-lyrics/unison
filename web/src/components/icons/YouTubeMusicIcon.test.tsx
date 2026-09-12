import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { YouTubeMusicIcon } from "./YouTubeMusicIcon"

afterEach(() => cleanup())

describe("YouTubeMusicIcon", () => {
  it("renders an svg and forwards props", () => {
    const { container } = render(<YouTubeMusicIcon className="size-4" data-testid="yt" />)
    const svg = container.querySelector("svg")
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute("class")).toContain("size-4")
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24")
  })

  it("is aria-hidden and uses currentColor", () => {
    const { container } = render(<YouTubeMusicIcon />)
    const svg = container.querySelector("svg")
    expect(svg?.getAttribute("aria-hidden")).toBe("true")
    expect(svg?.querySelector("path")?.getAttribute("fill")).toBe("currentColor")
  })
})
