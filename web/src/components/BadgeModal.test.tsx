import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { BadgeDef } from "@/lib/types"
import { BadgeModal, type BadgeModalSelection } from "./BadgeModal"

function def(key: string, extra: Partial<BadgeDef> = {}): BadgeDef {
  return {
    key,
    name: key,
    description: `${key} description`,
    category: "acclaim",
    kind: "medal",
    image: { color: `/badge-art/${key}.svg`, mono: `/badge-art/${key}_mono.svg` },
    ...extra,
  }
}

function sel(overrides: Partial<BadgeModalSelection> = {}): BadgeModalSelection {
  return {
    def: def("most-loved", { name: "Most Loved", description: "A lyric with strong support." }),
    userBadge: { key: "most-loved", earned: true, featured: false },
    rare: false,
    isCurrentTier: false,
    tierRank: null,
    ...overrides,
  }
}

const tiered = (): BadgeDef =>
  def("verified-contributor", {
    name: "Verified Contributor",
    category: "output",
    tiers: [
      { level: 1, name: "Tier I", threshold: 1 },
      { level: 2, name: "Tier II", threshold: 3 },
      { level: 3, name: "Tier III", threshold: 10 },
    ],
  })

function noop() {}

afterEach(cleanup)

describe("BadgeModal", () => {
  it("renders the name, description, category chip and earned state", () => {
    render(<BadgeModal selection={sel()} closing={false} onRequestClose={noop} onExited={noop} />)
    expect(screen.getByRole("heading", { level: 2, name: "Most Loved" })).toBeTruthy()
    expect(screen.getByText("A lyric with strong support.")).toBeTruthy()
    expect(screen.getByText("Earned")).toBeTruthy()
    expect(screen.getByText("Acclaim")).toBeTruthy()
  })

  it("labels the dialog and marks it modal for assistive tech", () => {
    render(<BadgeModal selection={sel()} closing={false} onRequestClose={noop} onExited={noop} />)
    const dialog = screen.getByRole("dialog")
    expect(dialog.getAttribute("aria-modal")).toBe("true")
    expect(dialog.getAttribute("aria-label")).toBe("Most Loved")
  })

  it("shows a Rare chip only when the badge is rare", () => {
    const { rerender } = render(
      <BadgeModal selection={sel({ rare: true })} closing={false} onRequestClose={noop} onExited={noop} />,
    )
    expect(screen.getByText("Rare")).toBeTruthy()
    rerender(<BadgeModal selection={sel({ rare: false })} closing={false} onRequestClose={noop} onExited={noop} />)
    expect(screen.queryByText("Rare")).toBeNull()
  })

  it("shows the tier ladder and 'Tier X of N unlocked' metric for an earned tiered badge", () => {
    const selection = sel({
      def: tiered(),
      userBadge: { key: "verified-contributor", earned: true, tier: 3, featured: false },
    })
    render(<BadgeModal selection={selection} closing={false} onRequestClose={noop} onExited={noop} />)
    expect(screen.getByText("Tier I · 1")).toBeTruthy()
    expect(screen.getByText("Tier III · 10")).toBeTruthy()
    expect(screen.getByTestId("badge-modal-metric").textContent).toContain("Tier 3 of 3 unlocked")
  })

  it("shows locked state and a 'more to unlock' metric with progress", () => {
    const selection = sel({
      def: tiered(),
      userBadge: {
        key: "verified-contributor",
        earned: false,
        progress: { current: 2, next: 3 },
        featured: false,
      },
    })
    render(<BadgeModal selection={selection} closing={false} onRequestClose={noop} onExited={noop} />)
    expect(screen.getByText("Locked · 2 of 3")).toBeTruthy()
    expect(screen.getByTestId("badge-modal-metric").textContent).toContain("1 more to unlock Tier I")
  })

  it("shows the tier rank in the state chip on the user's current tier badge", () => {
    const selection = sel({
      def: def("legendary", { name: "Legendary", category: "tier", kind: "title" }),
      userBadge: { key: "legendary", earned: true, featured: false },
      isCurrentTier: true,
      tierRank: 1,
    })
    render(<BadgeModal selection={selection} closing={false} onRequestClose={noop} onExited={noop} />)
    expect(screen.getByText("Earned · Rank #1")).toBeTruthy()
  })

  it("requests close on the close button, Escape, and a backdrop click", () => {
    const onRequestClose = vi.fn()
    render(<BadgeModal selection={sel()} closing={false} onRequestClose={onRequestClose} onExited={noop} />)

    fireEvent.click(screen.getByRole("button", { name: /close/i }))
    expect(onRequestClose).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(document, { key: "Escape" })
    expect(onRequestClose).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByTestId("badge-modal-overlay"))
    expect(onRequestClose).toHaveBeenCalledTimes(3)
  })

  it("does not request close when the card itself is clicked", () => {
    const onRequestClose = vi.fn()
    render(<BadgeModal selection={sel()} closing={false} onRequestClose={onRequestClose} onExited={noop} />)
    fireEvent.click(screen.getByRole("dialog"))
    expect(onRequestClose).not.toHaveBeenCalled()
  })

  it("calls onExited once the exit animation timeout elapses while closing", () => {
    vi.useFakeTimers()
    try {
      const onExited = vi.fn()
      const { rerender } = render(
        <BadgeModal selection={sel()} closing={false} onRequestClose={noop} onExited={onExited} />,
      )
      expect(onExited).not.toHaveBeenCalled()
      rerender(<BadgeModal selection={sel()} closing={true} onRequestClose={noop} onExited={onExited} />)
      act(() => {
        vi.advanceTimersByTime(260)
      })
      expect(onExited).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
