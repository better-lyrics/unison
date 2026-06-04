import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { VariantSummary } from "@/lib/types"
import { VariantList } from "./VariantList"

afterEach(() => cleanup())

function makeVariant(id: number, overrides: Partial<VariantSummary> = {}): VariantSummary {
  return {
    id,
    videoId: "vid",
    song: "Song",
    artist: "Artist",
    format: "ttml",
    syncType: "richsync",
    score: 5,
    effectiveScore: 5.4,
    voteCount: 7,
    confidence: "medium",
    hidden: false,
    ...overrides,
  }
}

describe("VariantList", () => {
  it("renders one row per variant", () => {
    const variants = [makeVariant(1), makeVariant(2), makeVariant(3)]
    render(<VariantList variants={variants} selectedId={1} onSelect={vi.fn()} />)
    expect(screen.getAllByRole("button")).toHaveLength(3)
  })

  it("marks the selected row with aria-current=true", () => {
    const variants = [makeVariant(10), makeVariant(11)]
    render(<VariantList variants={variants} selectedId={11} onSelect={vi.fn()} />)
    const buttons = screen.getAllByRole("button")
    expect(buttons[0].getAttribute("aria-current")).not.toBe("true")
    expect(buttons[1].getAttribute("aria-current")).toBe("true")
  })

  it("invokes onSelect with the row id when clicked", () => {
    const variants = [makeVariant(20), makeVariant(21)]
    const onSelect = vi.fn()
    render(<VariantList variants={variants} selectedId={20} onSelect={onSelect} />)
    const buttons = screen.getAllByRole("button")
    fireEvent.click(buttons[1])
    expect(onSelect).toHaveBeenCalledWith(21)
  })

  it("displays the rank number, score, and vote count for each row", () => {
    const variants = [makeVariant(30, { effectiveScore: 9.2, voteCount: 14 })]
    render(<VariantList variants={variants} selectedId={30} onSelect={vi.fn()} />)
    expect(screen.getByText("#1")).toBeTruthy()
    expect(screen.getByText("9.2")).toBeTruthy()
    expect(screen.getByText(/14/)).toBeTruthy()
  })

  it("renders the format badge alongside the row", () => {
    const variants = [makeVariant(40, { format: "lrc", syncType: "linesync" })]
    render(<VariantList variants={variants} selectedId={40} onSelect={vi.fn()} />)
    expect(screen.getByText("LRC")).toBeTruthy()
    expect(screen.getByText("linesync")).toBeTruthy()
  })

  it("renders an empty list when given no variants", () => {
    const { container } = render(<VariantList variants={[]} selectedId={0} onSelect={vi.fn()} />)
    expect(container.querySelectorAll("button")).toHaveLength(0)
  })
})
