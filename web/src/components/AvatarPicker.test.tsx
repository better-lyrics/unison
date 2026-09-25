import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/auth/AuthProvider"
import { useSession } from "@/auth/useSession"
import { clearAsyncDataCache } from "@/hooks/useAsyncData"
import { useDiscordLink } from "@/hooks/useDiscordLink"
import { saveStoredSession } from "@/lib/auth"
import type { UserSubmission } from "@/lib/types"
import { AvatarPicker } from "./AvatarPicker"

const KEY = "k".repeat(64)
const ALIEN = "https://cdn.betterlyrics.org/avatars/alien-cat.webp"
const GAMER = "https://cdn.betterlyrics.org/avatars/gamer-cat.webp"
const DISCORD = "https://cdn.discordapp.com/avatars/1/abc.png?size=128"
const artAt = (id: string, size: number) => `https://yt3.googleusercontent.com/${id}=w${size}-h${size}-l90-rj`

function submission(id: number, videoId: string, song: string, artist: string): UserSubmission {
  return {
    id,
    videoId,
    song,
    artist,
    duration: 200,
    format: "ttml",
    syncType: "richsync",
    effectiveScore: 1,
    voteCount: 1,
    confidence: "medium",
    createdAt: 1_790_000_000 - id,
    hidden: false,
  }
}

const LET_DOWN = submission(1, "ZVgHPSyEIqk", "Let Down", "Radiohead")
const HARVEY = submission(2, "T0Ry1m0Blug", "Harvey", "Her's")
const LET_DOWN_AGAIN = submission(3, "ZVgHPSyEIqk", "Let Down", "Radiohead")
const MOCKINGBIRD = submission(4, "9kznlAwE-8o", "Mockingbird", "Eminem")

interface Server {
  avatarUrl: string | null
  link: { linked: boolean; discordAvatarUrl: string | null }
  putStatus: number
  puts: unknown[]
  submissions: UserSubmission[]
  art: Record<string, string | null>
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
    submissions: [],
    art: {},
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
            display: { cdnBase: "https://cdn.betterlyrics.org/avatars/", artworkSize: 256 },
          },
        })
      }
      if (url === "/links/me") {
        return json({
          success: true,
          data: { discordId: server.link.linked ? "1" : null, discordUsername: null, ...server.link },
        })
      }
      if (url === `/users/${KEY}/submissions`) {
        return json({ success: true, data: { submissions: server.submissions } })
      }
      const artwork = url.match(/^\/artwork\?v=([^&]+)&size=(\d+)$/)
      if (artwork) {
        const id = server.art[artwork[1]]
        return json({ success: true, data: { artworkUrl: id ? artAt(id, Number(artwork[2])) : null } })
      }
      if (url === "/avatars/me" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { type: string; ref?: string }
        server.puts.push(body)
        if (server.putStatus !== 200) return json({ success: false, error: "REQUEST_FAILED" }, server.putStatus)
        const songArt = body.type === "song" && body.ref ? server.art[body.ref] : null
        const next =
          body.type === "preset"
            ? body.ref === "alien-cat"
              ? ALIEN
              : GAMER
            : body.type === "discord"
              ? DISCORD
              : songArt
                ? artAt(songArt, 256)
                : null
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

function PickerWithLink() {
  return <AvatarPicker discord={useDiscordLink()} />
}

function renderPicker() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <HeaderProbe />
        <PickerWithLink />
      </AuthProvider>
    </QueryClientProvider>,
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
      expect(screen.getByText(/without a custom photo keep the generated one/i)).toBeTruthy()
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

  describe("broken images", () => {
    it("hides a preset whose image fails to load", async () => {
      stubServer()
      renderPicker()
      const alien = await screen.findByRole("button", { name: "Alien Cat" })
      fireEvent.error(alien.querySelector("img") as HTMLImageElement)
      expect(screen.queryByRole("button", { name: "Alien Cat" })).toBeNull()
      expect(screen.getByRole("button", { name: "Gamer Cat" })).toBeTruthy()
    })

    it("offers a reconnect when the stored Discord photo no longer loads", async () => {
      stubServer({ link: { linked: true, discordAvatarUrl: DISCORD } })
      renderPicker()
      const discord = await screen.findByRole("button", { name: "Discord photo" })
      fireEvent.error(discord.querySelector("img") as HTMLImageElement)
      expect(screen.queryByRole("button", { name: "Discord photo" })).toBeNull()
      expect(screen.getByRole("button", { name: /use my discord photo/i })).toBeTruthy()
    })
  })

  describe("song covers", () => {
    const songServer = (overrides: Partial<Server> = {}) =>
      stubServer({
        submissions: [LET_DOWN, HARVEY, LET_DOWN_AGAIN, MOCKINGBIRD],
        art: { ZVgHPSyEIqk: "letdown", T0Ry1m0Blug: "harvey", "9kznlAwE-8o": "mockingbird" },
        ...overrides,
      })

    it("offers one tile per submitted song, newest first, labelled with song and artist", async () => {
      songServer()
      renderPicker()
      await screen.findByRole("button", { name: "Let Down · Radiohead" })
      expect(screen.getByText("From your songs")).toBeTruthy()
      const labels = screen
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label"))
        .filter((l) => l?.includes(" · "))
      expect(labels).toEqual(["Let Down · Radiohead", "Harvey · Her's", "Mockingbird · Eminem"])
    })

    it("shows each cover at the catalogue size", async () => {
      songServer()
      renderPicker()
      const tile = await screen.findByRole("button", { name: "Harvey · Her's" })
      expect(tile.querySelector("img")?.getAttribute("src")).toBe(artAt("harvey", 256))
    })

    it("saves a song pick and marks it selected", async () => {
      const server = songServer()
      renderPicker()
      const harvey = await screen.findByRole("button", { name: "Harvey · Her's" })
      await act(async () => {
        harvey.click()
      })
      await waitFor(() => expect(screen.getByTestId("header-avatar").textContent).toBe(artAt("harvey", 256)))
      expect(server.puts).toEqual([{ type: "song", ref: "T0Ry1m0Blug" }])
      expect(pressed("Harvey · Her's")).toBe("true")
      expect(pressed("Generated")).toBe("false")
    })

    it("marks the current song pick selected on load", async () => {
      songServer({ avatarUrl: artAt("mockingbird", 256) })
      renderPicker()
      await waitFor(() => expect(pressed("Mockingbird · Eminem")).toBe("true"))
      expect(pressed("Let Down · Radiohead")).toBe("false")
    })

    describe("edge cases", () => {
      it("has no songs group without submissions", async () => {
        stubServer()
        renderPicker()
        await screen.findByRole("button", { name: "Alien Cat" })
        expect(screen.queryByText("From your songs")).toBeNull()
      })

      it("leaves out a song without a cover", async () => {
        songServer({ art: { ZVgHPSyEIqk: "letdown", T0Ry1m0Blug: null, "9kznlAwE-8o": "mockingbird" } })
        renderPicker()
        await screen.findByRole("button", { name: "Mockingbird · Eminem" })
        expect(screen.queryByRole("button", { name: "Harvey · Her's" })).toBeNull()
      })

      it("hides a song whose cover fails to load", async () => {
        songServer()
        renderPicker()
        const harvey = await screen.findByRole("button", { name: "Harvey · Her's" })
        fireEvent.error(harvey.querySelector("img") as HTMLImageElement)
        expect(screen.queryByRole("button", { name: "Harvey · Her's" })).toBeNull()
        expect(screen.getByRole("button", { name: "Let Down · Radiohead" })).toBeTruthy()
      })
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
