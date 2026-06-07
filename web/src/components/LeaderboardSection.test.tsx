import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it } from "vitest"
import { LeaderboardSection } from "./LeaderboardSection"

afterEach(() => cleanup())

describe("LeaderboardSection", () => {
  it("renders the title", () => {
    render(
      <LeaderboardSection title="Most Wanted">
        <p>child</p>
      </LeaderboardSection>,
    )
    expect(screen.getByRole("heading", { name: "Most Wanted", level: 2 })).toBeTruthy()
  })

  it("renders the subtitle when provided", () => {
    render(
      <LeaderboardSection title="Most Wanted" subtitle="A descriptive line">
        <p>child</p>
      </LeaderboardSection>,
    )
    expect(screen.getByText("A descriptive line")).toBeTruthy()
  })

  it("omits the subtitle when not provided", () => {
    const { container } = render(
      <LeaderboardSection title="Most Wanted">
        <p>child</p>
      </LeaderboardSection>,
    )
    expect(container.querySelectorAll("p")).toHaveLength(1)
    expect(screen.getByText("child")).toBeTruthy()
  })

  it("renders children inside the section", () => {
    render(
      <LeaderboardSection title="Most Wanted">
        <p data-testid="child">child node</p>
      </LeaderboardSection>,
    )
    expect(screen.getByTestId("child").textContent).toBe("child node")
  })

  it("renders the action node when provided", () => {
    render(
      <MemoryRouter>
        <LeaderboardSection title="Most Wanted" action={<a href="/queue">See all</a>}>
          <p>child</p>
        </LeaderboardSection>
      </MemoryRouter>,
    )
    const link = screen.getByRole("link", { name: "See all" })
    expect(link.getAttribute("href")).toBe("/queue")
  })

  it("omits the action slot when no action is provided", () => {
    render(
      <LeaderboardSection title="Most Wanted">
        <p>child</p>
      </LeaderboardSection>,
    )
    expect(screen.queryByRole("link")).toBeNull()
  })
})
