import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/auth/AuthProvider"
import { LinkPage } from "./LinkPage"

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider>
        <LinkPage />
      </AuthProvider>
    </MemoryRouter>,
  )
}

function stubExtension(available: boolean, onAuth?: (req: { type: string }) => unknown) {
  if (!available) {
    vi.stubGlobal("chrome", undefined)
    return
  }
  vi.stubGlobal("chrome", {
    runtime: {
      connect: (_id: string, info: { name: string }) => {
        let onMessageListener: ((m: unknown) => void) | null = null
        return {
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
            queueMicrotask(() => onMessageListener?.(onAuth?.(req)))
          },
          disconnect: () => {},
        }
      },
    },
  })
}

beforeEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe("LinkPage outcome screens", () => {
  it("shows the success screen with the Discord name", async () => {
    stubExtension(false)
    renderAt("/link?status=linked&name=Alice")
    expect(await screen.findByText(/you are all set/i)).toBeTruthy()
    expect(screen.getByText(/as Alice/)).toBeTruthy()
  })

  it("shows the blocked screen for a community account", async () => {
    stubExtension(false)
    renderAt("/link?status=blocked")
    expect(await screen.findByText(/cannot be linked/i)).toBeTruthy()
  })

  it("shows an error screen with a try again action", async () => {
    stubExtension(false)
    renderAt("/link?status=error")
    expect(await screen.findByText(/something went wrong/i)).toBeTruthy()
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy()
  })
})

describe("LinkPage main flow", () => {
  it("prompts to install when the extension is missing", async () => {
    stubExtension(false)
    renderAt("/link")
    expect(await screen.findByText(/install better lyrics first/i)).toBeTruthy()
    expect(screen.getByRole("link", { name: /get better lyrics/i })).toBeTruthy()
  })

  it("shows the connect button when the extension is available", async () => {
    stubExtension(true, () => ({ ok: true }))
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })))
    renderAt("/link")
    expect(await screen.findByRole("button", { name: /connect with discord/i })).toBeTruthy()
  })

  it("runs the sign-and-start flow when Connect is clicked", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith("/auth/challenge")) {
        return new Response(JSON.stringify({ success: true, data: { nonce: "n".repeat(16), expiresAt: 1 } }), {
          status: 200,
        })
      }
      if (url.endsWith("/links/discord/start")) {
        return new Response(
          JSON.stringify({ success: true, data: { authorizeUrl: "https://discord.com/oauth2/authorize?x=1" } }),
          { status: 200 },
        )
      }
      return new Response("{}", { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(window.location, "assign").mockImplementation(() => {})
    stubExtension(true, (req) =>
      req.type === "bl-auth-request"
        ? { ok: true, signedBody: { payload: {}, signature: "", publicKey: {} } }
        : { ok: true },
    )

    renderAt("/link")
    const button = await screen.findByRole("button", { name: /connect with discord/i })
    await act(async () => {
      button.click()
    })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/auth/challenge"))
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/links/discord/start"))).toBe(true),
    )
  })
})
