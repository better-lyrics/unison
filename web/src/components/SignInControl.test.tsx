import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/auth/AuthProvider"
import { saveStoredSession, type StoredSession } from "@/lib/auth"
import { SignInControl } from "./SignInControl"

const valid: StoredSession = {
  sessionToken: "tok",
  keyId: "k".repeat(64),
  displayName: "BrightVivaceRoll",
  expiresAt: Math.floor(Date.now() / 1000) + 1000,
}

beforeEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe("SignInControl", () => {
  it("hides the sign-in button when the extension is not available", async () => {
    const { container } = render(
      <AuthProvider>
        <SignInControl />
      </AuthProvider>,
    )
    await waitFor(() => expect(container.querySelector('[data-state="signed-out"]')).toBeTruthy())
    expect(screen.queryByRole("button", { name: /sign in/i })).toBeNull()
  })

  it("shows the sign-in button when the extension is available", async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        async sendMessage() {
          return { ok: true }
        },
      },
    })
    render(
      <AuthProvider>
        <SignInControl />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy())
  })

  it("renders the identity chip with display name when signed in", async () => {
    saveStoredSession(valid)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            data: { keyId: valid.keyId, displayName: valid.displayName, expiresAt: valid.expiresAt },
          }),
          { status: 200 },
        ),
      ),
    )
    render(
      <AuthProvider>
        <SignInControl />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByText(valid.displayName)).toBeTruthy())
    expect(screen.getByRole("button", { name: /sign out/i })).toBeTruthy()
  })

  it("renders the sign-in button in error state when extension is available", async () => {
    saveStoredSession(valid)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: "INVALID_TOKEN" }), { status: 401 }),
      ),
    )
    vi.stubGlobal("chrome", {
      runtime: {
        async sendMessage() {
          return { ok: true }
        },
      },
    })
    render(
      <AuthProvider>
        <SignInControl />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy())
  })
})
