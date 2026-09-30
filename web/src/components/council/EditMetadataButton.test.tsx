import { AuthProvider } from "@/auth/AuthProvider"
import { ToastViewport } from "@/components/ToastViewport"
import { __resetToastStore } from "@/lib/toast"
import { councilData, metadataItem, stubCouncilApi } from "@/test/council-fixtures"
import { jsonResponse } from "@/test/fetch-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EditMetadataButton } from "./EditMetadataButton"

const VIDEO = "Lnk0000001A"
const CURRENT = { song: "Linked Song", artist: "Some Artist", album: null }

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
  __resetToastStore()
})

function renderButton() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AuthProvider>
          <EditMetadataButton videoId={VIDEO} lyricsId={51} current={CURRENT} />
          <ToastViewport />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function proposeRoute(log: string[], response = () => jsonResponse({ success: true, data: { id: 1 } })) {
  return {
    match: (url: string, init?: RequestInit) => init?.method === "POST" && url === "/committee/metadata",
    respond: (_: string, init?: RequestInit) => {
      log.push(String(init?.body))
      return response()
    },
  }
}

const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement
const propose = () => screen.getByRole("button", { name: "Propose" }) as HTMLButtonElement

describe("EditMetadataButton", () => {
  it("proposes changed details from a dialog filled with the current values", async () => {
    const log: string[] = []
    stubCouncilApi(councilData(), { admin: false }, [proposeRoute(log)])
    renderButton()
    fireEvent.click(await screen.findByRole("button", { name: /Edit details/ }))
    expect(screen.getByRole("dialog", { name: "Edit song details" })).toBeTruthy()
    expect(field("Title").value).toBe("Linked Song")
    expect(field("Artist").value).toBe("Some Artist")
    expect(field("Album").value).toBe("")
    expect(screen.getByText(/3 council members must approve/)).toBeTruthy()

    fireEvent.change(field("Album"), { target: { value: "  First Album " } })
    fireEvent.click(propose())

    await waitFor(() =>
      expect(log.map((body) => JSON.parse(body))).toEqual([
        { videoId: VIDEO, lyricsId: 51, song: "Linked Song", artist: "Some Artist", album: "First Album" },
      ]),
    )
    await screen.findByText("Proposed new details. 2 more approvals needed.")
    expect(screen.queryByRole("dialog", { name: "Edit song details" })).toBeNull()
  })

  describe("edge cases", () => {
    it("keeps Propose disabled until something changes or when a required field is empty", async () => {
      stubCouncilApi(councilData(), { admin: false })
      renderButton()
      fireEvent.click(await screen.findByRole("button", { name: /Edit details/ }))
      expect(propose().disabled).toBe(true)
      fireEvent.change(field("Title"), { target: { value: " Linked Song  " } })
      expect(propose().disabled).toBe(true)
      fireEvent.change(field("Title"), { target: { value: "   " } })
      expect(propose().disabled).toBe(true)
      fireEvent.change(field("Title"), { target: { value: "Renamed" } })
      expect(propose().disabled).toBe(false)
    })

    it("links to the open proposal instead of offering a new one", async () => {
      stubCouncilApi(councilData({ metadata: { items: [metadataItem({ id: 7001, videoId: VIDEO })], needed: 3 } }), {
        admin: false,
      })
      renderButton()
      const link = await screen.findByRole("link", { name: /Details proposal open/ })
      expect(link.getAttribute("href")).toBe("/council/metadata?item=7001")
      expect(screen.queryByRole("button", { name: /Edit details/ })).toBeNull()
    })

    it("closes the dialog on Cancel without sending anything", async () => {
      const log: string[] = []
      stubCouncilApi(councilData(), { admin: false }, [proposeRoute(log)])
      renderButton()
      fireEvent.click(await screen.findByRole("button", { name: /Edit details/ }))
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
      expect(screen.queryByRole("dialog")).toBeNull()
      expect(log).toEqual([])
    })
  })

  describe("error paths", () => {
    it("shows the server hint when another proposal is already open", async () => {
      stubCouncilApi(councilData(), { admin: false }, [
        proposeRoute([], () =>
          jsonResponse(
            {
              success: false,
              error: "Proposal already open",
              code: "PROPOSAL_OPEN",
              hint: "This song already has an open details proposal. Vote on it in the council dashboard.",
            },
            409,
          ),
        ),
      ])
      renderButton()
      fireEvent.click(await screen.findByRole("button", { name: /Edit details/ }))
      fireEvent.change(field("Artist"), { target: { value: "Other Artist" } })
      fireEvent.click(propose())
      expect(
        await screen.findByText("This song already has an open details proposal. Vote on it in the council dashboard."),
      ).toBeTruthy()
    })

    it("renders nothing for a signed-in user who is not on the council", async () => {
      const router = stubCouncilApi(councilData(), null)
      renderButton()
      await waitFor(() => expect(router.calls.some((c) => c.url === "/auth/me")).toBe(true))
      expect(screen.queryByRole("button", { name: /Edit details/ })).toBeNull()
      expect(router.calls.some((c) => c.url.startsWith("/committee/"))).toBe(false)
    })
  })
})
