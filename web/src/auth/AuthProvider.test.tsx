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
      <span data-testid="ext">{String(session.extensionAvailable)}</span>
      {session.status === "signed-out" || session.status === "error" ? (
        <span data-testid="signing-in">{String(session.signingIn)}</span>
      ) : null}
      {session.status === "signed-in" ? <span data-testid="name">{session.identity.displayName}</span> : null}
      {session.status === "error" ? <span data-testid="error">{session.error.message}</span> : null}
      {session.status === "signed-out" || session.status === "error" ? (
        <button type="button" onClick={() => session.signIn()}>
          sign-in
        </button>
      ) : null}
      {session.status === "signed-in" ? (
        <>
          <button type="button" onClick={() => session.signOut()}>
            sign-out
          </button>
          <button type="button" onClick={() => session.updateDisplayName("Renamed")}>
            rename
          </button>
        </>
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

function stubChromePort(makeResponse: (req: { type: string }) => unknown) {
  vi.stubGlobal("chrome", {
    runtime: {
      connect: (_id: string, info: { name: string }) => {
        let onMessageListener: ((m: unknown) => void) | null = null
        const port = {
          name: info.name,
          onMessage: {
            addListener: (l: (m: unknown) => void) => {
              onMessageListener = l
            },
          },
          onDisconnect: {
            addListener: (l: () => void) => {
              if (info.name === "bl-probe") queueMicrotask(l)
            },
          },
          postMessage: (req: { type: string }) => {
            queueMicrotask(() => onMessageListener?.(makeResponse(req)))
          },
          disconnect: () => {},
        }
        return port
      },
    },
  })
}

function stubChromePortMissing() {
  vi.stubGlobal("chrome", {
    runtime: {
      connect: (_id: string, info: { name: string }) => ({
        name: info.name,
        onMessage: { addListener: (_l: (m: unknown) => void) => {} },
        onDisconnect: {
          addListener: (l: () => void) => {
            queueMicrotask(l)
          },
        },
        postMessage: (_msg: unknown) => {},
        disconnect: () => {},
      }),
      lastError: { message: "Could not establish connection. Receiving end does not exist." },
    },
  })
}

interface DeferredPort {
  name: string
  onMessage: { addListener: (l: (m: unknown) => void) => void }
  onDisconnect: { addListener: (l: () => void) => void }
  postMessage: (msg: unknown) => void
  disconnect: () => void
}

function stubChromePortDeferred(): {
  authConnectCount: () => number
  resolveAll: (response: unknown) => void
} {
  const listeners: ((m: unknown) => void)[] = []
  let authCount = 0
  vi.stubGlobal("chrome", {
    runtime: {
      connect: (_id: string, info: { name: string }) => {
        if (info.name === "bl-auth-site") authCount++
        const port: DeferredPort = {
          name: info.name,
          onMessage: {
            addListener: (l: (m: unknown) => void) => {
              if (info.name === "bl-auth-site") listeners.push(l)
            },
          },
          onDisconnect: {
            addListener: (l: () => void) => {
              if (info.name === "bl-probe") queueMicrotask(l)
            },
          },
          postMessage: (_msg: unknown) => {},
          disconnect: () => {},
        }
        return port
      },
    },
  })
  return {
    authConnectCount: () => authCount,
    resolveAll: (response: unknown) => {
      for (const l of listeners) l(response)
    },
  }
}

describe("AuthProvider signIn flow", () => {
  it("runs challenge then extension then session and lands in signed-in", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { nonce: "n1", expiresAt: 1 } }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: valid }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    stubChromePort((msg) => {
      if (msg.type === "bl-auth-request") {
        return { ok: true, signedBody: { payload: {}, signature: "", publicKey: {} } }
      }
      return { ok: true }
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
    stubChromePort(() => ({ ok: false, reason: "USER_CANCELLED" }))
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
    stubChromePort((msg) => {
      if (msg.type !== "bl-auth-request") return { ok: true }
      if (cancelled) {
        cancelled = false
        return { ok: false, reason: "USER_CANCELLED" }
      }
      return { ok: true, signedBody: { payload: {}, signature: "", publicKey: {} } }
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

  it("updateDisplayName rewrites the rendered name and persists to storage", async () => {
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
    await waitFor(() => expect(screen.getByTestId("name").textContent).toBe(valid.displayName))
    await act(async () => {
      screen.getByText("rename").click()
    })
    await waitFor(() => expect(screen.getByTestId("name").textContent).toBe("Renamed"))
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as { displayName: string }
    expect(stored.displayName).toBe("Renamed")
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

describe("AuthProvider extension detection", () => {
  it("exposes extensionAvailable=true when the chrome runtime looks installed", async () => {
    stubChromePort(() => ({ ok: true }))
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signed-out"))
    expect(screen.getByTestId("ext").textContent).toBe("true")
  })

  it("exposes extensionAvailable=false when there is no chrome global", async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signed-out"))
    expect(screen.getByTestId("ext").textContent).toBe("false")
  })

  it("exposes extensionAvailable=false when the probe port disconnects with lastError", async () => {
    stubChromePortMissing()
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signed-out"))
    expect(screen.getByTestId("ext").textContent).toBe("false")
  })
})

describe("AuthProvider signingIn flag", () => {
  it("flips signingIn to true while the extension call is in flight", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { nonce: "n1", expiresAt: 1 } }), { status: 200 }),
      )
    vi.stubGlobal("fetch", fetchMock)
    const deferred = stubChromePortDeferred()
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByText("sign-in")).toBeTruthy())
    expect(screen.getByTestId("signing-in").textContent).toBe("false")
    await act(async () => {
      screen.getByText("sign-in").click()
    })
    await waitFor(() => expect(screen.getByTestId("signing-in").textContent).toBe("true"))
    expect(screen.getByTestId("status").textContent).toBe("signed-out")
    expect(deferred.authConnectCount()).toBe(1)
  })

  it("flips signingIn back to false after USER_CANCELLED so the error state can retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { nonce: "n1", expiresAt: 1 } }), { status: 200 }),
      )
    vi.stubGlobal("fetch", fetchMock)
    stubChromePort(() => ({ ok: false, reason: "USER_CANCELLED" }))
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
    expect(screen.getByTestId("signing-in").textContent).toBe("false")
  })

  it("dedupes two rapid sign-in clicks into a single port connect", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { nonce: "n1", expiresAt: 1 } }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: valid }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    const deferred = stubChromePortDeferred()
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByText("sign-in")).toBeTruthy())
    await act(async () => {
      screen.getByText("sign-in").click()
      screen.getByText("sign-in").click()
    })
    await waitFor(() => expect(screen.getByTestId("signing-in").textContent).toBe("true"))
    expect(deferred.authConnectCount()).toBe(1)
    await act(async () => {
      deferred.resolveAll({ ok: true, signedBody: { payload: {}, signature: "", publicKey: {} } })
    })
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signed-in"))
    expect(deferred.authConnectCount()).toBe(1)
  })
})
