import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CopyButton } from "./CopyButton"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function stubClipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } })
  return writeText
}

describe("CopyButton", () => {
  it("writes the given text to the clipboard on click", () => {
    const writeText = stubClipboard()
    render(<CopyButton text="hello world" />)
    fireEvent.click(screen.getByRole("button", { name: /copy lyrics body to clipboard/i }))
    expect(writeText).toHaveBeenCalledWith("hello world")
  })

  it("shows Copied! then reverts after the success timer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    stubClipboard()
    render(<CopyButton text="x" />)
    fireEvent.click(screen.getByRole("button", { name: /copy lyrics body to clipboard/i }))
    await waitFor(() => expect(screen.getByRole("button").textContent).toBe("Copied!"))
    vi.advanceTimersByTime(1500)
    await waitFor(() => expect(screen.getByRole("button").textContent).toBe("Copy"))
  })

  it("shows Copy failed then reverts after the failure timer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    stubClipboard(vi.fn().mockRejectedValue(new DOMException("no", "NotAllowedError")))
    render(<CopyButton text="x" />)
    fireEvent.click(screen.getByRole("button", { name: /copy lyrics body to clipboard/i }))
    await waitFor(() => expect(screen.getByRole("button").textContent).toBe("Copy failed"))
    vi.advanceTimersByTime(2500)
    await waitFor(() => expect(screen.getByRole("button").textContent).toBe("Copy"))
  })

  describe("edge cases", () => {
    it("is disabled when the clipboard API is unavailable", () => {
      vi.stubGlobal("navigator", { ...navigator, clipboard: undefined })
      render(<CopyButton text="x" />)
      expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true)
    })
  })
})
