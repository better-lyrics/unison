import { IconCheck } from "@tabler/icons-react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ActionBar } from "./ActionBar"

const PRIMARY = {
  label: "Approve",
  icon: IconCheck,
  shortcut: "A",
  confirmTitle: "Approve?",
  confirmBody: "It goes live.",
  confirmLabel: "Approve",
  unavailable: null,
}

const base = {
  primary: PRIMARY,
  onPrimary: vi.fn(),
  reject: { submitLabel: "Reject", hint: "Say why." },
  onReject: vi.fn(),
  busy: false,
}

afterEach(cleanup)

describe("ActionBar", () => {
  it("shows the bookmark control when the item can be bookmarked", () => {
    render(
      <ActionBar
        {...base}
        bookmark={{ kind: "open", capped: false, cap: 5 }}
        onBookmark={vi.fn()}
        bookmarkPending={false}
      />,
    )
    expect(screen.getByRole("button", { name: /Bookmark/ })).toBeTruthy()
  })

  describe("edge cases", () => {
    it("hides the bookmark control for items without bookmarks", () => {
      render(<ActionBar {...base} />)
      expect(screen.queryByRole("button", { name: /Bookmark/ })).toBeNull()
      expect(screen.getByRole("button", { name: /Approve/ })).toBeTruthy()
      expect(screen.getByRole("button", { name: /Reject/ })).toBeTruthy()
    })

    it("shows the unavailable label in place of the primary action", () => {
      render(<ActionBar {...base} primary={{ ...PRIMARY, unavailable: "You approved" }} />)
      const button = screen.getByRole("button", { name: "You approved" }) as HTMLButtonElement
      expect(button.disabled).toBe(true)
    })

    it("names the reject slot after the decision it makes", () => {
      render(<ActionBar {...base} reject={{ label: "Keep", submitLabel: "Keep", hint: "Closes the flag." }} />)
      expect(screen.getByRole("button", { name: /^Keep/ })).toBeTruthy()
      expect(screen.queryByRole("button", { name: /^Reject/ })).toBeNull()
    })

    it("labels the note with the reject wording by default", () => {
      render(<ActionBar {...base} />)
      act(() => void fireEvent.keyDown(window, { key: "r" }))
      const note = screen.getByRole("textbox", { name: /^Reason for the council/ })
      expect(note.getAttribute("placeholder")).toBe("For example: chorus timing lands early on every repeat")
    })

    it("takes the note label and placeholder from the reject slot", () => {
      render(
        <ActionBar
          {...base}
          reject={{ ...base.reject, noteLabel: "Why keep it? (optional)", placeholder: "For example: real lyrics" }}
        />,
      )
      act(() => void fireEvent.keyDown(window, { key: "r" }))
      const note = screen.getByRole("textbox", { name: /^Why keep it\? \(optional\)/ })
      expect(note.getAttribute("placeholder")).toBe("For example: real lyrics")
    })

    it("disables the reject slot and its shortcut when it is unavailable", () => {
      render(<ActionBar {...base} reject={{ ...base.reject, unavailable: true }} />)
      expect((screen.getByRole("button", { name: /^Reject/ }) as HTMLButtonElement).disabled).toBe(true)
      act(() => void fireEvent.keyDown(window, { key: "r" }))
      expect(screen.queryByRole("textbox")).toBeNull()
    })
  })
})
