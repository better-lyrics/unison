import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { CollapsibleSection } from "@/components/CollapsibleSection"

afterEach(cleanup)

describe("CollapsibleSection", () => {
  it("renders the title as a level-2 heading and shows the summary", () => {
    render(
      <CollapsibleSection title="Badges" summary={<span>6 of 12 unlocked</span>}>
        <p>body</p>
      </CollapsibleSection>,
    )
    expect(screen.getByRole("heading", { level: 2, name: "Badges" })).toBeTruthy()
    expect(screen.getByText("6 of 12 unlocked")).toBeTruthy()
  })

  it("is open by default and toggles on click", () => {
    render(
      <CollapsibleSection title="Badges">
        <p>body content</p>
      </CollapsibleSection>,
    )
    const toggle = screen.getByRole("button", { name: "Badges" })
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    fireEvent.click(toggle)
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(toggle)
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
  })

  it("starts collapsed when defaultOpen is false", () => {
    render(
      <CollapsibleSection title="Badges" defaultOpen={false}>
        <p>body content</p>
      </CollapsibleSection>,
    )
    expect(screen.getByRole("button", { name: "Badges" }).getAttribute("aria-expanded")).toBe("false")
  })

  it("keeps body content mounted while collapsed", () => {
    render(
      <CollapsibleSection title="Badges" defaultOpen={false}>
        <p>body content</p>
      </CollapsibleSection>,
    )
    expect(screen.getByText("body content")).toBeTruthy()
  })

  it("makes the collapsed body inert so its controls cannot take focus", () => {
    render(
      <CollapsibleSection title="Badges" defaultOpen={false}>
        <button type="button">inside</button>
      </CollapsibleSection>,
    )
    const toggle = screen.getByRole("button", { name: "Badges" })
    const body = document.getElementById(toggle.getAttribute("aria-controls") as string)
    expect(body?.hasAttribute("inert")).toBe(true)

    fireEvent.click(toggle)
    expect(body?.hasAttribute("inert")).toBe(false)
  })

  it("links the toggle to the body region via aria-controls", () => {
    render(
      <CollapsibleSection title="Badges">
        <p>body</p>
      </CollapsibleSection>,
    )
    const controls = screen.getByRole("button", { name: "Badges" }).getAttribute("aria-controls")
    expect(controls).toBeTruthy()
    expect(document.getElementById(controls as string)).not.toBeNull()
  })
})
