import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MigrateView } from "./MigrateView"

afterEach(cleanup)

describe("MigrateView", () => {
  it("prove: shows the connect button", () => {
    render(<MigrateView model={{ kind: "prove", connecting: false, error: null, onConnect: vi.fn() }} />)
    expect(screen.getByRole("button", { name: /connect with discord/i })).toBeTruthy()
    expect(screen.getByText(/prove your new key/i)).toBeTruthy()
  })

  it("prove: surfaces an error and a spinner while connecting", () => {
    render(<MigrateView model={{ kind: "prove", connecting: true, error: "nope", onConnect: vi.fn() }} />)
    expect(screen.getByText("nope")).toBeTruthy()
    expect(screen.getByRole("button", { name: /connecting/i })).toBeTruthy()
  })

  it("ready: greets by name and points back to Discord", () => {
    render(<MigrateView model={{ kind: "ready", name: "gwuhbruh" }} />)
    expect(screen.getByText(/new key verified/i)).toBeTruthy()
    expect(screen.getByText(/gwuhbruh/)).toBeTruthy()
    expect(screen.getByText(/back to discord/i)).toBeTruthy()
  })

  it("ready: works without a name", () => {
    render(<MigrateView model={{ kind: "ready", name: null }} />)
    expect(screen.getByText(/new key verified/i)).toBeTruthy()
  })

  it("same_key: explains there is nothing to move", () => {
    render(<MigrateView model={{ kind: "same_key" }} />)
    expect(screen.getByText(/same key/i)).toBeTruthy()
  })

  it("expired: tells the user to run migrate again", () => {
    render(<MigrateView model={{ kind: "expired" }} />)
    expect(screen.getByText(/that timed out/i)).toBeTruthy()
  })

  it("error: tells the user to try again from Discord", () => {
    render(<MigrateView model={{ kind: "error" }} />)
    expect(screen.getByText(/something went wrong/i)).toBeTruthy()
  })

  it("start: directs the user to begin from Discord", () => {
    render(<MigrateView model={{ kind: "start" }} />)
    expect(screen.getByText(/start from discord/i)).toBeTruthy()
  })

  it("install: prompts to install the extension", () => {
    render(<MigrateView model={{ kind: "install" }} />)
    expect(screen.getByRole("link", { name: /get better lyrics/i })).toBeTruthy()
  })
})
