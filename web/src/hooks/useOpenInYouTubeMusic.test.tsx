import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useOpenInYouTubeMusic } from "./useOpenInYouTubeMusic"

function Harness({ videoId }: { videoId: string }) {
  useOpenInYouTubeMusic(videoId)
  return <input aria-label="field" />
}

const press = (key: string, target: Window | Element = window) => fireEvent.keyDown(target, { key })

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(window, "open").mockReturnValue(null)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("useOpenInYouTubeMusic", () => {
  it("opens the song in YouTube Music on O", () => {
    render(<Harness videoId="SMQpJ9x7zEk" />)
    press("o")
    expect(window.open).toHaveBeenCalledWith("https://music.youtube.com/watch?v=SMQpJ9x7zEk", "_blank", "noreferrer")
  })

  describe("edge cases", () => {
    it("opens the song shown now after the selection changes", () => {
      const { rerender } = render(<Harness videoId="SMQpJ9x7zEk" />)
      rerender(<Harness videoId="oE56g61mW44" />)
      press("o")
      expect(window.open).toHaveBeenCalledTimes(1)
      expect(window.open).toHaveBeenCalledWith("https://music.youtube.com/watch?v=oE56g61mW44", "_blank", "noreferrer")
    })

    it("leaves O alone while typing in a field", () => {
      render(<Harness videoId="SMQpJ9x7zEk" />)
      const field = screen.getByRole("textbox")
      field.focus()
      press("o", field)
      expect(window.open).not.toHaveBeenCalled()
    })
  })
})
