import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { TierChip } from "./TierChip"

afterEach(() => cleanup())

describe("TierChip", () => {
  it("renders the capitalized tier label", () => {
    render(<TierChip tier="legendary" />)
    expect(screen.getByText("Legendary")).toBeTruthy()
  })

  it("capitalizes a compound tier name without uppercasing it", () => {
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

  it("renders the gem artwork when a source is given", () => {
    const { container } = render(<TierChip tier="legendary" gemSrc="/badge-art/legendary.svg" />)
    expect(container.querySelector('img[src="/badge-art/legendary.svg"]')).not.toBeNull()
  })

  it("falls back to the award icon without a gem source", () => {
    const { container } = render(<TierChip tier="legendary" />)
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector("svg")).not.toBeNull()
  })
})
