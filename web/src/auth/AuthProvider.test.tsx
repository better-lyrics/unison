import { STORAGE_KEY, type StoredSession, saveStoredSession } from "@/lib/auth"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "./AuthProvider"
import { useSession } from "./useSession"

const valid: StoredSession = {
  sessionToken: "tok",
  keyId: "k".repeat(64),
  displayName: "BrightVivaceRoll",
  expiresAt: Math.floor(Date.now() / 1000) + 1000,
}

function Probe() {
  const session = useSession()
  return (
    <>
      <span data-testid="status">{session.status}</span>
      {session.status === "signed-in" ? <span data-testid="name">{session.identity.displayName}</span> : null}
      {session.status === "error" ? <span data-testid="error">{session.error.message}</span> : null}
      {session.status === "signed-out" || session.status === "error" ? (
        <button type="button" onClick={() => session.signIn()}>
          sign-in
        </button>
      ) : null}
      {session.status === "signed-in" ? (
        <button type="button" onClick={() => session.signOut()}>
          sign-out
        </button>
      ) : null}
    </>
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe("AuthProvider initial state", () => {
  it("starts signed-out when storage is empty", async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signed-out"))
  })

  it("hydrates from storage and validates against /auth/me", async () => {
    saveStoredSession(valid)
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { keyId: valid.keyId, displayName: valid.displayName, expiresAt: valid.expiresAt },
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signed-in"))
    expect(screen.getByTestId("name").textContent).toBe(valid.displayName)
    expect(fetchMock).toHaveBeenCalledWith(
      "/auth/me",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: `Bearer ${valid.sessionToken}` }),
      }),
    )
  })

  it("wipes a stored session if /auth/me rejects", async () => {
    saveStoredSession(valid)
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ success: false, error: "INVALID_TOKEN" }), { status: 401 })),
    )
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signed-out"))
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

describe("AuthProvider signIn flow", () => {
  it("runs challenge then extension then session and lands in signed-in", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { nonce: "n1", expiresAt: 1 } }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: valid }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("chrome", {
      runtime: {
        async sendMessage(_id: string, msg: { type: string }) {
          if (msg.type === "bl-auth-request") {
            return { ok: true, signedBody: { payload: {}, signature: "", publicKey: {} } }
          }
          return { ok: true }
        },
      },
    })
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByText("sign-in")).toBeTruthy())
    await act(async () => {
      screen.getByText("sign-in").click()
    })
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signed-in"))
    expect(screen.getByTestId("name").textContent).toBe(valid.displayName)
  })

  it("lands in error state on cancel", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { nonce: "n1", expiresAt: 1 } }), { status: 200 }),
      )
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("chrome", {
      runtime: {
        async sendMessage() {
          return { ok: false, reason: "USER_CANCELLED" }
        },
      },
    })
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByText("sign-in")).toBeTruthy())
    await act(async () => {
      screen.getByText("sign-in").click()
    })
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"))
    expect(screen.getByTestId("error").textContent).toBe("USER_CANCELLED")
  })

  it("retries from error and lands in signed-in", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { nonce: "n1", expiresAt: 1 } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { nonce: "n2", expiresAt: 2 } }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: valid }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    let cancelled = true
    vi.stubGlobal("chrome", {
      runtime: {
        async sendMessage(_id: string, msg: { type: string }) {
          if (msg.type !== "bl-auth-request") return { ok: true }
          if (cancelled) {
            cancelled = false
            return { ok: false, reason: "USER_CANCELLED" }
          }
          return { ok: true, signedBody: { payload: {}, signature: "", publicKey: {} } }
        },
      },
    })
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByText("sign-in")).toBeTruthy())
    await act(async () => {
      screen.getByText("sign-in").click()
    })
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"))
    await act(async () => {
      screen.getByText("sign-in").click()
    })
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signed-in"))
    expect(screen.getByTestId("name").textContent).toBe(valid.displayName)
  })
})

describe("AuthProvider signOut", () => {
  it("clears storage, revokes the server session, and returns to signed-out", async () => {
    saveStoredSession(valid)
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { keyId: valid.keyId, displayName: valid.displayName, expiresAt: valid.expiresAt },
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByText("sign-out")).toBeTruthy())
    await act(async () => {
      screen.getByText("sign-out").click()
    })
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signed-out"))
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(fetchMock).toHaveBeenCalledWith(
      "/auth/logout",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: `Bearer ${valid.sessionToken}` }),
      }),
    )
  })

  it("still signs the user out locally when the revoke fetch fails", async () => {
    saveStoredSession(valid)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: { keyId: valid.keyId, displayName: valid.displayName, expiresAt: valid.expiresAt },
          }),
          { status: 200 },
        ),
      )
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    vi.stubGlobal("fetch", fetchMock)
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByText("sign-out")).toBeTruthy())
    await act(async () => {
      screen.getByText("sign-out").click()
    })
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signed-out"))
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})
