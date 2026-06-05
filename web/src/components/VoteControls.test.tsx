import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const upvote = vi.fn()
const downvote = vi.fn()
const report = vi.fn()

vi.mock("@/hooks/useVoteMutations", () => ({
  useVoteMutations: () => ({ upvote, downvote, report }),
}))

let sessionStatus: "signed-in" | "signed-out" | "loading" = "signed-in"

vi.mock("@/auth/useSession", () => ({
  useSession: () => ({ status: sessionStatus }),
}))

import { VoteControls } from "./VoteControls"

beforeEach(() => {
  upvote.mockReset()
  downvote.mockReset()
  report.mockReset()
  sessionStatus = "signed-in"
})

afterEach(() => {
  cleanup()
})

describe("VoteControls", () => {
  it("renders the vote count", () => {
    render(<VoteControls variantId={1} videoId="v1" variant={{ score: 42, userVote: null }} />)
    expect(screen.getByText("42")).toBeTruthy()
  })

  it("signed-out: all three buttons disabled with sign-in title", () => {
    sessionStatus = "signed-out"
    render(<VoteControls variantId={1} videoId="v1" variant={{ score: 0, userVote: null }} />)
    const up = screen.getByRole("button", { name: /upvote/i })
    const down = screen.getByRole("button", { name: /downvote/i })
    const flag = screen.getByRole("button", { name: /report/i })
    expect(up.hasAttribute("disabled")).toBe(true)
    expect(down.hasAttribute("disabled")).toBe(true)
    expect(flag.hasAttribute("disabled")).toBe(true)
    expect(up.getAttribute("title")).toBe("Sign in to vote")
    expect(down.getAttribute("title")).toBe("Sign in to vote")
    expect(flag.getAttribute("title")).toBe("Sign in to vote")
  })

  it("clicking upvote when userVote is null calls upvote", () => {
    render(<VoteControls variantId={1} videoId="v1" variant={{ score: 0, userVote: null }} />)
    fireEvent.click(screen.getByRole("button", { name: /upvote/i }))
    expect(upvote).toHaveBeenCalledTimes(1)
  })

  it("clicking downvote calls downvote", () => {
    render(<VoteControls variantId={1} videoId="v1" variant={{ score: 0, userVote: null }} />)
    fireEvent.click(screen.getByRole("button", { name: /downvote/i }))
    expect(downvote).toHaveBeenCalledTimes(1)
  })

  it("upvote button is aria-pressed=true when userVote=1", () => {
    render(<VoteControls variantId={1} videoId="v1" variant={{ score: 1, userVote: 1 }} />)
    expect(screen.getByRole("button", { name: /upvote/i }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("button", { name: /downvote/i }).getAttribute("aria-pressed")).toBe("false")
  })

  it("downvote button is aria-pressed=true when userVote=-1", () => {
    render(<VoteControls variantId={1} videoId="v1" variant={{ score: -1, userVote: -1 }} />)
    expect(screen.getByRole("button", { name: /upvote/i }).getAttribute("aria-pressed")).toBe("false")
    expect(screen.getByRole("button", { name: /downvote/i }).getAttribute("aria-pressed")).toBe("true")
  })

  it("report button opens a menu with five menuitems", () => {
    render(<VoteControls variantId={1} videoId="v1" variant={{ score: 0, userVote: null }} />)
    const trigger = screen.getByRole("button", { name: /report/i })
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu")
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(trigger)
    expect(trigger.getAttribute("aria-expanded")).toBe("true")
    const items = screen.getAllByRole("menuitem")
    expect(items).toHaveLength(5)
  })

  it("clicking a menuitem calls report with the reason and closes the menu", () => {
    render(<VoteControls variantId={1} videoId="v1" variant={{ score: 0, userVote: null }} />)
    fireEvent.click(screen.getByRole("button", { name: /report/i }))
    fireEvent.click(screen.getByRole("menuitem", { name: /spam/i }))
    expect(report).toHaveBeenCalledWith("spam")
    expect(screen.queryByRole("menuitem")).toBeNull()
  })

  it("each menuitem maps to the correct report reason", () => {
    render(<VoteControls variantId={1} videoId="v1" variant={{ score: 0, userVote: null }} />)
    fireEvent.click(screen.getByRole("button", { name: /report/i }))
    fireEvent.click(screen.getByRole("menuitem", { name: /wrong song/i }))
    expect(report).toHaveBeenCalledWith("wrong_song")

    fireEvent.click(screen.getByRole("button", { name: /report/i }))
    fireEvent.click(screen.getByRole("menuitem", { name: /bad sync/i }))
    expect(report).toHaveBeenCalledWith("bad_sync")

    fireEvent.click(screen.getByRole("button", { name: /report/i }))
    fireEvent.click(screen.getByRole("menuitem", { name: /offensive/i }))
    expect(report).toHaveBeenCalledWith("offensive")

    fireEvent.click(screen.getByRole("button", { name: /report/i }))
    fireEvent.click(screen.getByRole("menuitem", { name: /other/i }))
    expect(report).toHaveBeenCalledWith("other")
  })

  it("Escape closes the menu without firing a report", () => {
    render(<VoteControls variantId={1} videoId="v1" variant={{ score: 0, userVote: null }} />)
    fireEvent.click(screen.getByRole("button", { name: /report/i }))
    expect(screen.getAllByRole("menuitem")).toHaveLength(5)
    fireEvent.keyDown(window, { key: "Escape" })
    expect(screen.queryByRole("menuitem")).toBeNull()
    expect(report).not.toHaveBeenCalled()
  })

  it("outside click closes the menu without firing a report", () => {
    render(
      <div>
        <button type="button" data-testid="outside">
          outside
        </button>
        <VoteControls variantId={1} videoId="v1" variant={{ score: 0, userVote: null }} />
      </div>,
    )
    fireEvent.click(screen.getByRole("button", { name: /report/i }))
    expect(screen.getAllByRole("menuitem")).toHaveLength(5)
    fireEvent.mouseDown(screen.getByTestId("outside"))
    expect(screen.queryByRole("menuitem")).toBeNull()
    expect(report).not.toHaveBeenCalled()
  })
})
