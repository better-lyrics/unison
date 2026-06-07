import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { VariantBadge } from "./VariantBadge"

afterEach(() => cleanup())

describe("VariantBadge", () => {
  it("renders the uppercase format label", () => {
    render(<VariantBadge format="ttml" syncType="richsync" />)
    expect(screen.getByText("TTML")).toBeTruthy()
  })

  it("renders the sync type label", () => {
    render(<VariantBadge format="lrc" syncType="linesync" />)
    expect(screen.getByText("linesync")).toBeTruthy()
  })

  it("applies a TTML-specific class", () => {
    const { container } = render(<VariantBadge format="ttml" syncType="richsync" />)
    const badge = container.firstElementChild as HTMLElement
    expect(badge.getAttribute("data-format")).toBe("ttml")
  })

  it("applies an LRC-specific class", () => {
    const { container } = render(<VariantBadge format="lrc" syncType="linesync" />)
    const badge = container.firstElementChild as HTMLElement
    expect(badge.getAttribute("data-format")).toBe("lrc")
  })

  it("applies a plain-specific class", () => {
    const { container } = render(<VariantBadge format="plain" syncType="plain" />)
    const badge = container.firstElementChild as HTMLElement
    expect(badge.getAttribute("data-format")).toBe("plain")
  })
})
