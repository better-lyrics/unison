import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/auth/AuthProvider"
import { useSession } from "@/auth/useSession"
import { clearAsyncDataCache } from "@/hooks/useAsyncData"
import { saveStoredSession } from "@/lib/auth"
import { OwnerControls } from "./OwnerControls"

const KEY = "k".repeat(64)
const DISCORD = "https://cdn.discordapp.com/avatars/1/abc.png?size=128"

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function stubServer(opts: { avatarUrl: string | null; unlinkStatus?: number }) {
  const calls: string[] = []
  let linked = true
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push(`${init?.method ?? "GET"} ${url}`)
      if (url === "/auth/me") {
        return json({
          success: true,
          data: { keyId: KEY, displayName: "Kay", expiresAt: 9_999_999_999, avatarUrl: opts.avatarUrl },
        })
      }
      if (url === "/avatars") {
        return json({ success: true, data: { presets: [], display: { cdnBase: "https://cdn/" } } })
      }
      if (url === "/links/me") {
        return json({
          success: true,
          data: linked
            ? { linked: true, discordId: "1", discordUsername: "kay", discordAvatarUrl: DISCORD }
            : { linked: false, discordId: null, discordUsername: null, discordAvatarUrl: null },
        })
      }
      if (url === "/links/discord" && init?.method === "DELETE") {
        if (opts.unlinkStatus && opts.unlinkStatus !== 200)
          return json({ success: false, error: "x" }, opts.unlinkStatus)
        linked = false
        return json({ success: true, data: { unlinked: true } })
      }
      return new Response(null, { status: 404 })
    }),
  )
  return calls
}

function HeaderProbe() {
  const session = useSession()
  return (
    <span data-testid="header-avatar">
      {session.status === "signed-in" ? (session.identity.avatarUrl ?? "none") : ""}
    </span>
  )
}

function renderControls() {
  return render(
    <AuthProvider>
      <HeaderProbe />
      <OwnerControls />
    </AuthProvider>,
  )
}

async function disconnect() {
  const button = await screen.findByRole("button", { name: "Disconnect" })
  await act(async () => {
    button.click()
  })
}

beforeEach(() => {
  localStorage.clear()
  clearAsyncDataCache()
  saveStoredSession({ sessionToken: "tok", keyId: KEY, displayName: "Kay", expiresAt: 9_999_999_999 })
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  clearAsyncDataCache()
  vi.unstubAllGlobals()
})

describe("OwnerControls", () => {
  it("reads the Discord link once for both the picker and the Discord section", async () => {
    const calls = stubServer({ avatarUrl: null })
    renderControls()
    await screen.findByRole("button", { name: "Discord photo" })
    expect(calls.filter((c) => c === "GET /links/me")).toHaveLength(1)
  })

  it("drops the Discord photo from the picker and the header after disconnecting", async () => {
    stubServer({ avatarUrl: DISCORD })
    renderControls()
    await waitFor(() => expect(screen.getByTestId("header-avatar").textContent).toBe(DISCORD))

    await disconnect()

    await waitFor(() => expect(screen.getByTestId("header-avatar").textContent).toBe("none"))
    expect(screen.queryByRole("button", { name: "Discord photo" })).toBeNull()
  })

  describe("invariants", () => {
    it("keeps a preset pick when Discord is disconnected", async () => {
      const preset = "https://cdn.betterlyrics.org/avatars/alien-cat.webp"
      stubServer({ avatarUrl: preset })
      renderControls()
      await waitFor(() => expect(screen.getByTestId("header-avatar").textContent).toBe(preset))

      await disconnect()

      await waitFor(() => expect(screen.queryByRole("button", { name: "Discord photo" })).toBeNull())
      expect(screen.getByTestId("header-avatar").textContent).toBe(preset)
    })
  })

  describe("error paths", () => {
    it("keeps the Discord photo when the disconnect fails", async () => {
      stubServer({ avatarUrl: DISCORD, unlinkStatus: 500 })
      renderControls()
      await waitFor(() => expect(screen.getByTestId("header-avatar").textContent).toBe(DISCORD))

      await disconnect()

      await screen.findByText(/could not disconnect/i)
      expect(screen.getByTestId("header-avatar").textContent).toBe(DISCORD)
    })
  })
})
