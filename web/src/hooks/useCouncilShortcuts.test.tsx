import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { type ShortcutMap, useCouncilShortcuts } from "./useCouncilShortcuts"

function Harness({ map, enabled = true }: { map: ShortcutMap; enabled?: boolean }) {
  useCouncilShortcuts(map, enabled)
  return (
    <div>
      <input data-testid="field" aria-label="field" />
      <textarea data-testid="note" aria-label="note" />
      <button type="button" data-testid="btn">
        btn
      </button>
    </div>
  )
}

const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key, ...init })

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("useCouncilShortcuts", () => {
  it("runs single-key shortcuts case-insensitively, so Caps Lock does not matter", () => {
    const j = vi.fn()
    const help = vi.fn()
    render(<Harness map={{ j, "?": help }} />)
    press("j")
    press("J")
    press("?", { shiftKey: true })
    expect(j).toHaveBeenCalledTimes(2)
    expect(help).toHaveBeenCalledTimes(1)
  })

  it("runs a g chord within the window and forgets it after", () => {
    const goQueue = vi.fn()
    render(<Harness map={{ "g q": goQueue }} />)
    press("g")
    press("q")
    expect(goQueue).toHaveBeenCalledTimes(1)
    press("g")
    vi.advanceTimersByTime(1001)
    press("q")
    expect(goQueue).toHaveBeenCalledTimes(1)
  })

  it("prefers a chord over the single key that follows g", () => {
    const goEdits = vi.fn()
    const approve = vi.fn()
    render(<Harness map={{ "g e": goEdits, e: approve }} />)
    press("g")
    press("e")
    expect(goEdits).toHaveBeenCalledTimes(1)
    expect(approve).not.toHaveBeenCalled()
  })

  it("completes a chord from one owner without running another owner's single key", () => {
    const goActivity = vi.fn()
    const approve = vi.fn()
    render(
      <>
        <Harness map={{ "g a": goActivity }} />
        <Harness map={{ a: approve }} />
      </>,
    )
    press("g")
    press("a")
    expect(goActivity).toHaveBeenCalledTimes(1)
    expect(approve).not.toHaveBeenCalled()
    press("a")
    expect(approve).toHaveBeenCalledTimes(1)
  })

  it("lets the most recently mounted owner win a shared key", () => {
    const outer = vi.fn()
    const inner = vi.fn()
    const { rerender } = render(<Harness map={{ j: outer }} />)
    rerender(
      <>
        <Harness map={{ j: outer }} />
        <Harness map={{ j: inner }} />
      </>,
    )
    press("j")
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
  })

  it("ignores plain keys while focus is inside a dialog", () => {
    const s = vi.fn()
    render(
      <>
        <Harness map={{ s }} />
        <dialog open>
          <button type="button">inside</button>
        </dialog>
      </>,
    )
    screen.getByRole("button", { name: "inside" }).focus()
    press("s")
    expect(s).not.toHaveBeenCalled()
  })

  it("handles mod+k with either modifier", () => {
    const palette = vi.fn()
    render(<Harness map={{ "mod+k": palette }} />)
    press("k", { metaKey: true })
    press("k", { ctrlKey: true })
    expect(palette).toHaveBeenCalledTimes(2)
  })

  describe("edge cases", () => {
    it("ignores plain keys while typing but still opens the command menu", () => {
      const s = vi.fn()
      const palette = vi.fn()
      render(<Harness map={{ s, "mod+k": palette }} />)
      screen.getByTestId("note").focus()
      fireEvent.keyDown(screen.getByTestId("note"), { key: "s" })
      fireEvent.keyDown(screen.getByTestId("note"), { key: "k", metaKey: true })
      expect(s).not.toHaveBeenCalled()
      expect(palette).toHaveBeenCalledTimes(1)
    })

    it("ignores other modifier combinations", () => {
      const s = vi.fn()
      render(<Harness map={{ s }} />)
      press("s", { metaKey: true })
      press("s", { ctrlKey: true })
      press("s", { altKey: true })
      expect(s).not.toHaveBeenCalled()
    })

    it("does nothing while disabled", () => {
      const j = vi.fn()
      render(<Harness map={{ j }} enabled={false} />)
      press("j")
      expect(j).not.toHaveBeenCalled()
    })

    it("regression: Shift with a letter does not run the letter shortcut", () => {
      const seal = vi.fn()
      render(<Harness map={{ s: seal }} />)
      press("S", { shiftKey: true })
      expect(seal).not.toHaveBeenCalled()
    })

    it("regression: mod shortcuts do not reach the page while a dialog has focus", () => {
      const submit = vi.fn()
      const palette = vi.fn()
      render(
        <>
          <Harness map={{ "mod+Enter": submit, "mod+k": palette }} />
          {/* biome-ignore lint/a11y/useSemanticElements: floating-ui dialogs render this exact shape */}
          <div role="dialog" aria-label="menu">
            <button type="button">inside</button>
          </div>
        </>,
      )
      screen.getByRole("button", { name: "inside" }).focus()
      press("Enter", { metaKey: true })
      expect(submit).not.toHaveBeenCalled()
      press("k", { metaKey: true })
      expect(palette).toHaveBeenCalledTimes(1)
    })

    it("passes the key on when a handler declines it", () => {
      const lower = vi.fn()
      render(
        <>
          <Harness map={{ "/": lower }} />
          <Harness map={{ "/": () => false }} />
        </>,
      )
      const event = new KeyboardEvent("keydown", { key: "/", cancelable: true })
      window.dispatchEvent(event)
      expect(lower).toHaveBeenCalledTimes(1)
      expect(event.defaultPrevented).toBe(true)
    })

    it("leaves the browser default alone when every handler declines", () => {
      render(<Harness map={{ "/": () => false }} />)
      const event = new KeyboardEvent("keydown", { key: "/", cancelable: true })
      window.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    })

    it("regression: a held key does not fire twice", () => {
      const s = vi.fn()
      render(<Harness map={{ s }} />)
      press("s", { repeat: true })
      expect(s).not.toHaveBeenCalled()
    })
  })

  describe("invariants", () => {
    it("removes its listener on unmount", () => {
      const j = vi.fn()
      render(<Harness map={{ j }} />)
      cleanup()
      press("j")
      expect(j).not.toHaveBeenCalled()
    })

    it("prevents the browser default for handled keys only", () => {
      render(<Harness map={{ "/": vi.fn() }} />)
      const handled = new KeyboardEvent("keydown", { key: "/", cancelable: true })
      const ignored = new KeyboardEvent("keydown", { key: "x", cancelable: true })
      window.dispatchEvent(handled)
      window.dispatchEvent(ignored)
      expect(handled.defaultPrevented).toBe(true)
      expect(ignored.defaultPrevented).toBe(false)
    })
  })
})
