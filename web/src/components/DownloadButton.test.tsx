import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DownloadButton } from "./DownloadButton"

afterEach(() => cleanup())

describe("DownloadButton", () => {
  it("calls onClick when clicked", () => {
    const onClick = vi.fn()
    render(<DownloadButton onClick={onClick} />)
    fireEvent.click(screen.getByRole("button", { name: /download lyrics file/i }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("does not fire onClick while disabled", () => {
    const onClick = vi.fn()
    render(<DownloadButton onClick={onClick} disabled />)
    fireEvent.click(screen.getByRole("button", { name: /download lyrics file/i }))
    expect(onClick).not.toHaveBeenCalled()
  })
})
