import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { __resetToastStore, pushToast } from "@/lib/toast"
import { ToastViewport } from "./ToastViewport"

beforeEach(() => {
  __resetToastStore()
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  __resetToastStore()
})

describe("ToastViewport", () => {
  it("renders nothing initially when the store is empty", () => {
    const { container } = render(<ToastViewport />)
    expect(container.querySelectorAll("[data-toast-id]")).toHaveLength(0)
  })

  it("renders toasts from the store", () => {
    render(<ToastViewport />)
    act(() => {
      pushToast({ kind: "info", message: "Hello there" })
    })
    expect(screen.getByText("Hello there")).toBeTruthy()
  })

  it("renders multiple toasts in order", () => {
    render(<ToastViewport />)
    act(() => {
      pushToast({ kind: "info", message: "first" })
      pushToast({ kind: "error", message: "second" })
    })
    const items = screen.getAllByRole("status")
    expect(items[0]?.textContent).toContain("first")
    expect(items[1]?.textContent).toContain("second")
  })

  it("clicking the close button dismisses that toast immediately", () => {
    render(<ToastViewport />)
    act(() => {
      pushToast({ kind: "info", message: "x" })
    })
    expect(screen.getByText("x")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /dismiss notification/i }))
    expect(screen.queryByText("x")).toBeNull()
  })

  it("sets aria-live polite on the container", () => {
    const { container } = render(<ToastViewport />)
    const region = container.querySelector("[aria-live]")
    expect(region).toBeTruthy()
    expect(region?.getAttribute("aria-live")).toBe("polite")
  })

  it("color-codes by kind via a data attribute", () => {
    render(<ToastViewport />)
    act(() => {
      pushToast({ kind: "success", message: "ok" })
      pushToast({ kind: "error", message: "err" })
      pushToast({ kind: "info", message: "info" })
    })
    const kinds = screen.getAllByRole("status").map((el) => el.getAttribute("data-toast-kind"))
    expect(kinds).toEqual(["success", "error", "info"])
  })

  it("auto-removes a toast from the DOM after its duration elapses", () => {
    render(<ToastViewport />)
    act(() => {
      pushToast({ kind: "info", message: "gone" })
    })
    expect(screen.getByText("gone")).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.queryByText("gone")).toBeNull()
  })
})
