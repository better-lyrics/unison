import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { MedalRank } from "./MedalRank"

afterEach(() => cleanup())

describe("MedalRank", () => {
  it("renders a gold trophy with '1st place' label for rank 1", () => {
    const { container } = render(<MedalRank rank={1} />)
    const svg = container.querySelector("svg")
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute("class")).toContain("text-unison-medal-gold")
    expect(screen.getByText("1st place")).toBeTruthy()
  })

  it("renders a silver trophy with '2nd place' label for rank 2", () => {
    const { container } = render(<MedalRank rank={2} />)
    expect(container.querySelector("svg")?.getAttribute("class")).toContain("text-unison-medal-silver")
    expect(screen.getByText("2nd place")).toBeTruthy()
  })

  it("renders a bronze trophy with '3rd place' label for rank 3", () => {
    const { container } = render(<MedalRank rank={3} />)
    expect(container.querySelector("svg")?.getAttribute("class")).toContain("text-unison-medal-bronze")
    expect(screen.getByText("3rd place")).toBeTruthy()
  })

  it("renders formatRank text for rank 4 and rank 10 with no trophy", () => {
    const { container, rerender } = render(<MedalRank rank={4} />)
    expect(container.querySelector("svg")).toBeNull()
    expect(screen.getByText("#4")).toBeTruthy()
    rerender(<MedalRank rank={10} />)
    expect(screen.getByText("#10")).toBeTruthy()
  })

  it("applies the small wrapper width by default and a wider one when size is lg", () => {
    const { container, rerender } = render(<MedalRank rank={1} />)
    const small = container.firstChild as HTMLElement
    expect(small.className).toContain("w-10")
    rerender(<MedalRank rank={1} size="lg" />)
    const large = container.firstChild as HTMLElement
    expect(large.className).toContain("w-14")
  })
})
