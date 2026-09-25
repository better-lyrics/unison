import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/auth/AuthProvider"
import { useSession } from "@/auth/useSession"
import { clearAsyncDataCache } from "@/hooks/useAsyncData"
import { saveStoredSession } from "@/lib/auth"
import { AvatarPicker } from "./AvatarPicker"

const KEY = "k".repeat(64)
const ALIEN = "https://cdn.betterlyrics.org/avatars/alien-cat.webp"
const GAMER = "https://cdn.betterlyrics.org/avatars/gamer-cat.webp"
const DISCORD = "https://cdn.discordapp.com/avatars/1/abc.png?size=128"

interface Server {
  avatarUrl: string | null
  link: { linked: boolean; discordAvatarUrl: string | null }
  putStatus: number
  puts: unknown[]
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function stubServer(overrides: Partial<Server> = {}): Server {
  const server: Server = {
    avatarUrl: null,
    link: { linked: false, discordAvatarUrl: null },
    putStatus: 200,
    puts: [],
    ...overrides,
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/auth/me") {
        return json({
          success: true,
          data: { keyId: KEY, displayName: "Kay", expiresAt: 9_999_999_999, avatarUrl: server.avatarUrl },
        })
      }
      if (url === "/avatars") {
        return json({
          success: true,
          data: {
            presets: [
              { id: "alien-cat", label: "Alien Cat", url: ALIEN },
              { id: "gamer-cat", label: "Gamer Cat", url: GAMER },
            ],
            display: { cdnBase: "https://cdn.betterlyrics.org/avatars/" },
          },
        })
      }
      if (url === "/links/me") {
        return json({
          success: true,
          data: { discordId: server.link.linked ? "1" : null, discordUsername: null, ...server.link },
        })
      }
      if (url === "/avatars/me" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { type: string; ref?: string }
        server.puts.push(body)
        if (server.putStatus !== 200) return json({ success: false, error: "REQUEST_FAILED" }, server.putStatus)
        const next =
          body.type === "preset" ? (body.ref === "alien-cat" ? ALIEN : GAMER) : body.type === "discord" ? DISCORD : null
        server.avatarUrl = next
        return json({ success: true, data: { avatarUrl: next } })
      }
      return new Response(null, { status: 404 })
    }),
  )
  return server
}

function HeaderProbe() {
  const session = useSession()
  return (
    <span data-testid="header-avatar">
      {session.status === "signed-in" ? (session.identity.avatarUrl ?? "none") : ""}
    </span>
  )
}

function renderPicker() {
  return render(
    <AuthProvider>
      <HeaderProbe />
      <AvatarPicker />
    </AuthProvider>,
  )
}

const pressed = (name: string) => screen.getByRole("button", { name }).getAttribute("aria-pressed")

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

describe("AvatarPicker", () => {
  it("offers the generated default and every preset, with the default selected", async () => {
    stubServer()
    renderPicker()
    await screen.findByRole("button", { name: "Alien Cat" })
    expect(screen.getByRole("button", { name: "Gamer Cat" })).toBeTruthy()
    expect(pressed("Generated")).toBe("true")
    expect(pressed("Alien Cat")).toBe("false")
  })

  it("saves a preset pick and updates the signed-in header", async () => {
    const server = stubServer()
    renderPicker()
    const alien = await screen.findByRole("button", { name: "Alien Cat" })
    await act(async () => {
      alien.click()
    })
    await waitFor(() => expect(screen.getByTestId("header-avatar").textContent).toBe(ALIEN))
    expect(server.puts).toEqual([{ type: "preset", ref: "alien-cat" }])
    expect(pressed("Alien Cat")).toBe("true")
    expect(pressed("Generated")).toBe("false")
  })

  it("returns to the generated default", async () => {
    const server = stubServer({ avatarUrl: ALIEN })
    renderPicker()
    await waitFor(() => expect(pressed("Alien Cat")).toBe("true"))
    await act(async () => {
      screen.getByRole("button", { name: "Generated" }).click()
    })
    await waitFor(() => expect(screen.getByTestId("header-avatar").textContent).toBe("none"))
    expect(server.puts).toEqual([{ type: "default" }])
  })

  describe("Discord photo", () => {
    it("offers the stored Discord photo when the account is linked with one", async () => {
      const server = stubServer({ link: { linked: true, discordAvatarUrl: DISCORD } })
      renderPicker()
      const discord = await screen.findByRole("button", { name: "Discord photo" })
      await act(async () => {
        discord.click()
      })
      await waitFor(() => expect(screen.getByTestId("header-avatar").textContent).toBe(DISCORD))
      expect(server.puts).toEqual([{ type: "discord" }])
    })

    it("asks a linked account without a stored photo to reconnect", async () => {
      stubServer({ link: { linked: true, discordAvatarUrl: null } })
      renderPicker()
      expect(await screen.findByRole("button", { name: /use my discord photo/i })).toBeTruthy()
      expect(screen.queryByRole("button", { name: "Discord photo" })).toBeNull()
    })

    it("offers nothing Discord-related when the account is not linked", async () => {
      stubServer()
      renderPicker()
      await screen.findByRole("button", { name: "Alien Cat" })
      expect(screen.queryByRole("button", { name: "Discord photo" })).toBeNull()
      expect(screen.queryByRole("button", { name: /use my discord photo/i })).toBeNull()
    })
  })

  describe("error paths", () => {
    it("keeps the current pick and explains when saving fails", async () => {
      stubServer({ putStatus: 500 })
      renderPicker()
      const alien = await screen.findByRole("button", { name: "Alien Cat" })
      await act(async () => {
        alien.click()
      })
      expect(await screen.findByText(/could not save/i)).toBeTruthy()
      expect(screen.getByTestId("header-avatar").textContent).toBe("none")
      expect(pressed("Generated")).toBe("true")
    })
  })
})
