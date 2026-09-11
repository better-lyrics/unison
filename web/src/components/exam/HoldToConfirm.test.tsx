import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { HoldToConfirm } from "./HoldToConfirm"

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe("HoldToConfirm", () => {
  it("fires only after the hold threshold is reached", () => {
    const onConfirm = vi.fn()
    render(
      <HoldToConfirm onConfirm={onConfirm} holdMs={700}>
        Commit
      </HoldToConfirm>,
    )
    const btn = screen.getByRole("button")
    fireEvent.pointerDown(btn)
    vi.advanceTimersByTime(699)
    expect(onConfirm).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it("does not fire when released before the threshold", () => {
    const onConfirm = vi.fn()
    render(
      <HoldToConfirm onConfirm={onConfirm} holdMs={700}>
        Commit
      </HoldToConfirm>,
    )
    const btn = screen.getByRole("button")
    fireEvent.pointerDown(btn)
    vi.advanceTimersByTime(400)
    fireEvent.pointerUp(btn)
    vi.advanceTimersByTime(1000)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it("cancels when the pointer leaves before the threshold", () => {
    const onConfirm = vi.fn()
    render(
      <HoldToConfirm onConfirm={onConfirm} holdMs={700}>
        Commit
      </HoldToConfirm>,
    )
    const btn = screen.getByRole("button")
    fireEvent.pointerDown(btn)
    vi.advanceTimersByTime(300)
    fireEvent.pointerLeave(btn)
    vi.advanceTimersByTime(1000)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it("commits on a held Space key and cancels on release", () => {
    const onConfirm = vi.fn()
    render(
      <HoldToConfirm onConfirm={onConfirm} holdMs={500}>
        Commit
      </HoldToConfirm>,
    )
    const btn = screen.getByRole("button")
    fireEvent.keyDown(btn, { key: " " })
    vi.advanceTimersByTime(500)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it("does nothing when disabled", () => {
    const onConfirm = vi.fn()
    render(
      <HoldToConfirm onConfirm={onConfirm} holdMs={300} disabled>
        Commit
      </HoldToConfirm>,
    )
    const btn = screen.getByRole("button")
    fireEvent.pointerDown(btn)
    vi.advanceTimersByTime(1000)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
