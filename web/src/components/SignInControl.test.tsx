import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/auth/AuthProvider"
import { clearAsyncDataCache } from "@/hooks/useAsyncData"
import { dicebearThumbsDataUri } from "@/lib/avatar"
import { saveStoredSession, type StoredSession } from "@/lib/auth"
import { IDENTITY_FILE_ERRORS } from "@/lib/identity-file"
import { identityFile, makeIdentityExport } from "@/test/identity-fixture"
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

function stubSessionFetch(extra: Record<string, unknown> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { keyId: valid.keyId, displayName: valid.displayName, expiresAt: valid.expiresAt, ...extra },
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
  async function openSignInMenu() {
    const button = await screen.findByRole("button", { name: "Sign in" })
    await act(async () => {
      button.click()
    })
    return button
  }

  async function uploadIdentity(file: File) {
    const input = screen.getByLabelText("Identity file") as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } })
    })
  }

  function stubFileSignIn(keyId: string) {
    const fetchMock = vi.fn(async (url: string) =>
      url === "/auth/challenge"
        ? new Response(JSON.stringify({ success: true, data: { nonce: "nonce-0123456789abcdef", expiresAt: 1 } }))
        : new Response(JSON.stringify({ success: true, data: { ...valid, keyId } })),
    )
    vi.stubGlobal("fetch", fetchMock)
    return fetchMock
  }

  describe("without the extension", () => {
    it("shows a Sign in menu button instead of the extension button", async () => {
      const { container } = renderControl()
      await waitFor(() => expect(container.querySelector('[data-state="no-extension"]')).toBeTruthy())
      expect(screen.getByRole("button", { name: "Sign in" }).getAttribute("aria-haspopup")).toBe("menu")
      expect(screen.queryByRole("button", { name: /sign in with better lyrics/i })).toBeNull()
      expect(screen.queryByRole("menu")).toBeNull()
    })

    it("opens a menu with the upload, the export steps and the install link", async () => {
      renderControl()
      await openSignInMenu()
      expect(screen.getByRole("menuitem", { name: /upload identity file/i })).toBeTruthy()
      expect(
        screen.getByText(
          "Export it in Better Lyrics options → Identity → Export Key. Only upload it on this site, it is the key to your account.",
        ),
      ).toBeTruthy()
      const link = screen.getByRole("menuitem", { name: /get better lyrics/i })
      expect(link.getAttribute("href")).toBe("https://betterlyrics.org")
      expect((screen.getByLabelText("Identity file") as HTMLInputElement).accept).toBe(".json,application/json")
    })

    it("signs in with an uploaded identity file and shows the account chip", async () => {
      const exported = await makeIdentityExport()
      stubFileSignIn(exported.keyId)
      renderControl()
      await openSignInMenu()
      await uploadIdentity(identityFile(exported))
      expect(await screen.findByRole("button", { name: valid.displayName })).toBeTruthy()
      expect(screen.queryByRole("menu")).toBeNull()
    })

    it("keeps the menu open and shows the error for a bad file", async () => {
      stubFileSignIn("k".repeat(64))
      renderControl()
      await openSignInMenu()
      await uploadIdentity(identityFile("not json"))
      expect(await screen.findByRole("alert")).toBeTruthy()
      expect(screen.getByRole("alert").textContent).toBe(IDENTITY_FILE_ERRORS.notIdentity)
      expect(screen.getByRole("menu")).toBeTruthy()
    })

    it("lets the same file be picked again after a failure", async () => {
      stubFileSignIn("k".repeat(64))
      renderControl()
      await openSignInMenu()
      await uploadIdentity(identityFile("not json"))
      await screen.findByRole("alert")
      expect((screen.getByLabelText("Identity file") as HTMLInputElement).value).toBe("")
    })

    it("closes the menu on Escape", async () => {
      renderControl()
      await openSignInMenu()
      await act(async () => {
        fireEvent.keyDown(document, { key: "Escape" })
      })
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull())
    })

    it("closes the menu on an outside click", async () => {
      renderControl()
      await openSignInMenu()
      await act(async () => {
        fireEvent.mouseDown(document.body)
      })
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull())
    })

    it("regression: does not reopen the account menu after signing in from the file menu", async () => {
      const exported = await makeIdentityExport()
      stubFileSignIn(exported.keyId)
      renderControl()
      await openSignInMenu()
      await uploadIdentity(identityFile(exported))
      const chip = await screen.findByRole("button", { name: valid.displayName })
      expect(chip.getAttribute("aria-expanded")).toBe("false")
    })
  })

  it("shows the sign-in button when the extension is available", async () => {
    stubChromePort(() => ({ ok: true }))
    renderControl()
    await waitFor(() => expect(screen.getByRole("button", { name: /sign in with better lyrics/i })).toBeTruthy())
    expect(screen.queryByLabelText("Identity file")).toBeNull()
  })

  it("renders the identity chip with display name when signed in", async () => {
    saveStoredSession(valid)
    stubSessionFetch()
    renderControl()
    await waitFor(() => expect(screen.getByText(valid.displayName)).toBeTruthy())
    expect(screen.getByRole("button", { name: valid.displayName })).toBeTruthy()
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("shows the chosen avatar in the identity chip", async () => {
    const avatarUrl = "https://cdn.betterlyrics.org/avatars/alien-cat.webp"
    saveStoredSession(valid)
    stubSessionFetch({ avatarUrl })
    const { container } = renderControl()
    await waitFor(() => expect(screen.getByText(valid.displayName)).toBeTruthy())
    expect(container.querySelector('[data-state="signed-in"] img')?.getAttribute("src")).toBe(avatarUrl)
  })

  it("falls back to the generated avatar when none is chosen", async () => {
    saveStoredSession(valid)
    stubSessionFetch({ avatarUrl: null })
    const { container } = renderControl()
    await waitFor(() => expect(screen.getByText(valid.displayName)).toBeTruthy())
    expect(container.querySelector('[data-state="signed-in"] img')?.getAttribute("src")).toBe(
      dicebearThumbsDataUri(valid.keyId),
    )
  })

  it("renders the sign-in button in error state when extension is available", async () => {
    saveStoredSession(valid)
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ success: false, error: "INVALID_TOKEN" }), { status: 401 })),
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
