import { IconCheck } from "@tabler/icons-react"
import { cleanup, render, screen } from "@testing-library/react"
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
  })
})
