import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { TierChip } from "./TierChip"

afterEach(() => cleanup())

describe("TierChip", () => {
  it("renders the capitalized tier label", () => {
    render(<TierChip tier="legendary" />)
    expect(screen.getByText("Legendary")).toBeTruthy()
  })

  it("capitalizes a compound tier name", () => {
    render(<TierChip tier="grandmaster" />)
    expect(screen.getByText("Grandmaster")).toBeTruthy()
  })

  it("exposes the tier via a data attribute", () => {
    const { container } = render(<TierChip tier="elite" />)
    expect(container.querySelector('[data-tier="elite"]')).not.toBeNull()
  })

  it("includes the rank in the title when provided", () => {
    const { container } = render(<TierChip tier="master" rank={3} />)
    expect(container.querySelector('[data-tier="master"]')?.getAttribute("title")).toContain("#3")
  })
})
