import { AuthProvider } from "@/auth/AuthProvider"
import { ToastViewport } from "@/components/ToastViewport"
import { __resetToastStore } from "@/lib/toast"
import { councilData, queueItem, stubCouncilApi } from "@/test/council-fixtures"
import { jsonResponse } from "@/test/fetch-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SealLyricButton } from "./SealLyricButton"

const VIDEO = "Lnk0000001A"
const lyric = queueItem({ id: 51, videoId: VIDEO, song: "Linked Song" })

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
  __resetToastStore()
})

function renderButton(lyricsId = 51) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AuthProvider>
          <SealLyricButton videoId={VIDEO} lyricsId={lyricsId} />
          <ToastViewport />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function sealRoute(log: string[]) {
  return {
    match: (url: string, init?: RequestInit) => init?.method === "POST" && url === "/lyrics/51/boost",
    respond: (url: string) => {
      log.push(url)
      return jsonResponse({ success: true })
    },
  }
}

describe("SealLyricButton", () => {
  it("seals the lyric after a confirmation", async () => {
    const log: string[] = []
    stubCouncilApi(councilData({ sealable: { [VIDEO]: [lyric] } }), { admin: false }, [sealRoute(log)])
    renderButton()
    fireEvent.click(await screen.findByRole("button", { name: /^Seal/ }))
    expect(log).toEqual([])
    fireEvent.click(screen.getByRole("button", { name: "Seal lyric" }))
    await waitFor(() => expect(log).toEqual(["/lyrics/51/boost"]))
    await screen.findByText("Sealed “Linked Song”")
  })

  it("drops the button as soon as the seal is sent", async () => {
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    stubCouncilApi(councilData({ sealable: { [VIDEO]: [lyric] } }), { admin: false }, [
      {
        match: (url, init) => init?.method === "POST" && url === "/lyrics/51/boost",
        respond: async () => {
          await held
          return jsonResponse({ success: true })
        },
      },
    ])
    renderButton()
    fireEvent.click(await screen.findByRole("button", { name: /^Seal/ }))
    fireEvent.click(screen.getByRole("button", { name: "Seal lyric" }))
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Seal/ })).toBeNull())
    release()
  })

  it("puts the button back and says why when the seal fails", async () => {
    let lookups = 0
    stubCouncilApi(councilData({ sealable: { [VIDEO]: [lyric] } }), { admin: false }, [
      {
        match: (url) => url === `/committee/queue/video/${VIDEO}`,
        respond: () => {
          lookups++
          return lookups === 1 ? jsonResponse({ success: true, data: [lyric] }) : new Promise<Response>(() => {})
        },
      },
      {
        match: (url, init) => init?.method === "POST" && url === "/lyrics/51/boost",
        respond: () => jsonResponse({ success: false, error: "Monthly seal quota reached" }, 409),
      },
    ])
    renderButton()
    fireEvent.click(await screen.findByRole("button", { name: /^Seal/ }))
    fireEvent.click(screen.getByRole("button", { name: "Seal lyric" }))
    await screen.findByText("Monthly seal quota reached")
    expect(await screen.findByRole("button", { name: /^Seal/ })).toBeTruthy()
  })

  it("sends nothing when the member cancels", async () => {
    const log: string[] = []
    stubCouncilApi(councilData({ sealable: { [VIDEO]: [lyric] } }), { admin: false }, [sealRoute(log)])
    renderButton()
    fireEvent.click(await screen.findByRole("button", { name: /^Seal/ }))
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(screen.getByRole("button", { name: /^Seal/ })).toBeTruthy()
    expect(log).toEqual([])
  })

  describe("edge cases", () => {
    it("shows nothing for a lyric that cannot be sealed", async () => {
      const router = stubCouncilApi(councilData({ sealable: { [VIDEO]: [lyric] } }))
      renderButton(99)
      await waitFor(() => expect(router.calls.some((c) => c.url === `/committee/queue/video/${VIDEO}`)).toBe(true))
      expect(screen.queryByRole("button", { name: /^Seal/ })).toBeNull()
    })

    it("asks the server nothing for a visitor who is not on the council", async () => {
      const router = stubCouncilApi(councilData({ sealable: { [VIDEO]: [lyric] } }), null)
      renderButton()
      await waitFor(() => expect(router.calls.some((c) => c.url === "/auth/me")).toBe(true))
      expect(router.calls.some((c) => c.url.startsWith("/committee/"))).toBe(false)
      expect(screen.queryByRole("button", { name: /^Seal/ })).toBeNull()
    })

    it("renders nothing outside a signed-in session", () => {
      const client = new QueryClient()
      const { container } = render(
        <QueryClientProvider client={client}>
          <SealLyricButton videoId={VIDEO} lyricsId={51} />
        </QueryClientProvider>,
      )
      expect(container.innerHTML).toBe("")
    })
  })
})
