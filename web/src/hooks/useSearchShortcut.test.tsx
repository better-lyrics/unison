import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useRef } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { useSearchShortcut } from "./useSearchShortcut"

function Harness({ enabled = true }: { enabled?: boolean }) {
  const ref = useRef<HTMLInputElement | null>(null)
  useSearchShortcut(ref, enabled)
  return (
    <div>
      <input ref={ref} data-testid="target" aria-label="target" />
      <input data-testid="other" aria-label="other" />
      <button type="button" data-testid="btn">
        btn
      </button>
    </div>
  )
}

afterEach(cleanup)

describe("useSearchShortcut", () => {
  it("focuses the ref on Cmd+/ from anywhere", () => {
    render(<Harness />)
    screen.getByTestId("btn").focus()
    fireEvent.keyDown(window, { key: "/", metaKey: true })
    expect(document.activeElement).toBe(screen.getByTestId("target"))
  })

  it("focuses the ref on Ctrl+/ from anywhere", () => {
    render(<Harness />)
    screen.getByTestId("btn").focus()
    fireEvent.keyDown(window, { key: "/", ctrlKey: true })
    expect(document.activeElement).toBe(screen.getByTestId("target"))
  })

  it("focuses the ref on a bare / when focus is not in a field", () => {
    render(<Harness />)
    screen.getByTestId("btn").focus()
    fireEvent.keyDown(window, { key: "/" })
    expect(document.activeElement).toBe(screen.getByTestId("target"))
  })

  it("ignores a bare / when focus is already in a text field", () => {
    render(<Harness />)
    const other = screen.getByTestId("other")
    other.focus()
    fireEvent.keyDown(window, { key: "/" })
    expect(document.activeElement).toBe(other)
  })

  it("does nothing when disabled", () => {
    render(<Harness enabled={false} />)
    const btn = screen.getByTestId("btn")
    btn.focus()
    fireEvent.keyDown(window, { key: "/", metaKey: true })
    expect(document.activeElement).toBe(btn)
  })
})
