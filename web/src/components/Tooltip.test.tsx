import { fireEvent } from "@testing-library/dom"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { Tooltip } from "./Tooltip"

afterEach(() => cleanup())

describe("Tooltip", () => {
  it("shows the label on hover and hides on leave", async () => {
    render(
      <Tooltip label="Word-by-word synced lyrics">
        <button type="button">richsync</button>
      </Tooltip>,
    )
    const trigger = screen.getByText("richsync")
    expect(screen.queryByRole("tooltip")).toBeNull()
    fireEvent.mouseEnter(trigger)
    const tip = await screen.findByRole("tooltip")
    expect(tip.textContent).toContain("Word-by-word synced lyrics")
    fireEvent.mouseLeave(trigger)
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull())
  })

  it("keeps the trigger content and forwards a single child", () => {
    render(
      <Tooltip label="Line-by-line synced lyrics">
        <button type="button">linesync</button>
      </Tooltip>,
    )
    expect(screen.getByText("linesync").tagName).toBe("BUTTON")
  })
})
