import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/auth/AuthProvider"
import { clearAsyncDataCache } from "@/hooks/useAsyncData"
import { saveStoredSession, type StoredSession } from "@/lib/auth"
import { SignInControl } from "./SignInControl"

const valid: StoredSession = {
  sessionToken: "tok",
  keyId: "k".repeat(64),
  displayName: "BrightVivaceRoll",
  expiresAt: Math.floor(Date.now() / 1000) + 1000,
}

function renderControl() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <SignInControl />
      </AuthProvider>
    </MemoryRouter>,
  )
}

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

function stubChromePortDeferred(): { resolveAll: (response: unknown) => void } {
  const listeners: ((m: unknown) => void)[] = []
  vi.stubGlobal("chrome", {
    runtime: {
      connect: (_id: string, info: { name: string }) => ({
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
      }),
    },
  })
  return {
    resolveAll: (response: unknown) => {
      for (const l of listeners) l(response)
    },
  }
}

function stubSessionFetch() {
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
}

async function openDropdown() {
  const chip = await screen.findByRole("button", { name: valid.displayName })
  await act(async () => {
    chip.click()
  })
  return chip
}

beforeEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
  clearAsyncDataCache()
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
  clearAsyncDataCache()
})

describe("SignInControl", () => {
  it("shows a Get Better Lyrics link when the extension is not available", async () => {
    const { container } = renderControl()
    await waitFor(() => expect(container.querySelector('[data-state="no-extension"]')).toBeTruthy())
    expect(screen.queryByRole("button", { name: /sign in/i })).toBeNull()
    const link = screen.getByRole("link", { name: /get better lyrics/i })
    expect(link.getAttribute("href")).toBe("https://betterlyrics.org")
  })

  it("shows the sign-in button when the extension is available", async () => {
    stubChromePort(() => ({ ok: true }))
    renderControl()
    await waitFor(() => expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy())
  })

  it("renders the identity chip with display name when signed in", async () => {
    saveStoredSession(valid)
    stubSessionFetch()
    renderControl()
    await waitFor(() => expect(screen.getByText(valid.displayName)).toBeTruthy())
    expect(screen.getByRole("button", { name: valid.displayName })).toBeTruthy()
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("renders the sign-in button in error state when extension is available", async () => {
    saveStoredSession(valid)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: "INVALID_TOKEN" }), { status: 401 }),
      ),
    )
    stubChromePort(() => ({ ok: true }))
    renderControl()
    await waitFor(() => expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy())
  })

  it("calls the sign-in flow when the button is clicked", async () => {
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
    renderControl()
    const button = await screen.findByRole("button", { name: /sign in/i })
    await act(async () => {
      button.click()
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/auth/challenge"))
    await waitFor(() => expect(screen.getByText(valid.displayName)).toBeTruthy())
  })

  it("opens the dropdown when the chip is clicked", async () => {
    saveStoredSession(valid)
    stubSessionFetch()
    renderControl()
    await openDropdown()
    expect(screen.getByRole("menu")).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: /sign out/i })).toBeTruthy()
  })

  it("closes the dropdown when an outside click happens", async () => {
    saveStoredSession(valid)
    stubSessionFetch()
    renderControl()
    await openDropdown()
    expect(screen.getByRole("menu")).toBeTruthy()
    await act(async () => {
      fireEvent.mouseDown(document.body)
    })
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull())
  })

  it("closes the dropdown on Escape", async () => {
    saveStoredSession(valid)
    stubSessionFetch()
    renderControl()
    await openDropdown()
    expect(screen.getByRole("menu")).toBeTruthy()
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" })
    })
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull())
  })

  it("renders the keyId preview, copy button, view stats link, and sign out in the dropdown", async () => {
    saveStoredSession(valid)
    stubSessionFetch()
    renderControl()
    await openDropdown()
    const preview = `${valid.keyId.slice(0, 6)}…${valid.keyId.slice(-6)}`
    const code = screen.getByText(preview)
    expect(code.getAttribute("title")).toBe(valid.keyId)
    expect(screen.getByRole("button", { name: /copy key id/i })).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: /view stats/i })).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: /sign out/i })).toBeTruthy()
  })

  it("copies the keyId when the copy button is clicked", async () => {
    saveStoredSession(valid)
    stubSessionFetch()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } })
    renderControl()
    await openDropdown()
    const copyButton = screen.getByRole("button", { name: /copy key id/i })
    await act(async () => {
      copyButton.click()
    })
    expect(writeText).toHaveBeenCalledWith(valid.keyId)
    await waitFor(() => expect(screen.getByRole("button", { name: /copied/i })).toBeTruthy())
  })

  it("navigates to /me via the View stats link", async () => {
    saveStoredSession(valid)
    stubSessionFetch()
    renderControl()
    await openDropdown()
    const link = screen.getByRole("menuitem", { name: /view stats/i })
    expect(link.getAttribute("href")).toBe("/me")
  })

  it("calls signOut when the dropdown sign-out is clicked", async () => {
    saveStoredSession(valid)
    stubSessionFetch()
    renderControl()
    await openDropdown()
    const signOutButton = screen.getByRole("menuitem", { name: /sign out/i })
    await act(async () => {
      signOutButton.click()
    })
    await waitFor(() => expect(localStorage.getItem("unison.session.v1")).toBeNull())
  })

  it("renders the loading skeleton on initial render", () => {
    saveStoredSession(valid)
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})))
    const { container } = renderControl()
    expect(container.querySelector('[data-state="loading"]')).toBeTruthy()
  })

  it("disables the sign-in button while a sign-in is in flight", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { nonce: "n1", expiresAt: 1 } }), { status: 200 }),
      )
    vi.stubGlobal("fetch", fetchMock)
    const deferred = stubChromePortDeferred()
    renderControl()
    const button = await screen.findByRole("button", { name: /sign in/i })
    expect((button as HTMLButtonElement).disabled).toBe(false)
    await act(async () => {
      button.click()
    })
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true))
    await act(async () => {
      button.click()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => {
      deferred.resolveAll({ ok: false, reason: "USER_CANCELLED" })
    })
    const retry = await screen.findByRole("button", { name: /sign in/i })
    await waitFor(() => expect((retry as HTMLButtonElement).disabled).toBe(false))
  })
})
