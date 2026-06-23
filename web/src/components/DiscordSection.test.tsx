import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { type DiscordSectionModel, DiscordSectionView } from "./DiscordSection"

afterEach(cleanup)

const base: DiscordSectionModel = {
  status: "unlinked",
  username: null,
  connecting: false,
  working: false,
  error: null,
  onConnect: () => {},
  onDisconnect: () => {},
}

describe("DiscordSectionView", () => {
  it("offers a connect button when unlinked", () => {
    const onConnect = vi.fn()
    render(<DiscordSectionView model={{ ...base, status: "unlinked", onConnect }} />)
    const button = screen.getByRole("button", { name: /connect with discord/i })
    act(() => button.click())
    expect(onConnect).toHaveBeenCalledOnce()
  })

  it("shows the username and a disconnect button when linked", () => {
    const onDisconnect = vi.fn()
    render(<DiscordSectionView model={{ ...base, status: "linked", username: "user#1234", onDisconnect }} />)
    expect(screen.getByText(/as user#1234/)).toBeTruthy()
    const button = screen.getByRole("button", { name: /^disconnect$/i })
    act(() => button.click())
    expect(onDisconnect).toHaveBeenCalledOnce()
  })

  it("disables the disconnect button while working", () => {
    render(<DiscordSectionView model={{ ...base, status: "linked", username: "x", working: true }} />)
    const button = screen.getByRole("button", { name: /disconnecting/i })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it("surfaces an error message", () => {
    render(<DiscordSectionView model={{ ...base, status: "unlinked", error: "nope" }} />)
    expect(screen.getByText("nope")).toBeTruthy()
  })
})
