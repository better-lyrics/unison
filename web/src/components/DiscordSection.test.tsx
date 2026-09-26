import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { type DiscordSectionModel, DiscordSectionView } from "./DiscordSection"
import { DISCORD_NEEDS_EXTENSION } from "./discord-ui"

afterEach(cleanup)

const base: DiscordSectionModel = {
  status: "unlinked",
  username: null,
  connecting: false,
  canConnect: true,
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

  describe("without the extension", () => {
    it("locks the connect button and does not call onConnect", () => {
      const onConnect = vi.fn()
      render(<DiscordSectionView model={{ ...base, status: "unlinked", canConnect: false, onConnect }} />)
      const button = screen.getByRole("button", { name: /connect with discord/i })
      expect(button.getAttribute("aria-disabled")).toBe("true")
      act(() => button.click())
      expect(onConnect).not.toHaveBeenCalled()
    })

    it("explains why on hover", async () => {
      render(<DiscordSectionView model={{ ...base, status: "unlinked", canConnect: false }} />)
      const button = screen.getByRole("button", { name: /connect with discord/i })
      await act(async () => {
        fireEvent.mouseEnter(button)
      })
      expect((await screen.findByRole("tooltip")).textContent).toBe(DISCORD_NEEDS_EXTENSION)
    })

    it("keeps disconnect working for a linked account", () => {
      const onDisconnect = vi.fn()
      render(<DiscordSectionView model={{ ...base, status: "linked", canConnect: false, onDisconnect }} />)
      act(() => screen.getByRole("button", { name: /^disconnect$/i }).click())
      expect(onDisconnect).toHaveBeenCalledOnce()
    })
  })
})
