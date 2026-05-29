import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { clearAsyncDataCache } from "@/hooks/useAsyncData"
import { DownloadsPage } from "./DownloadsPage"

const manifest = {
  schema_version: 1,
  generated_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
  sha256: "abc123",
  bytes: 100_000_000,
  dump_url: "https://unison-dumps.boidu.dev/unison-2026-05-29.dump",
  latest_url: "https://unison-dumps.boidu.dev/latest.dump",
  row_counts: { lyrics: 184231, requested_songs: 9821, lyrics_requests: 14502 },
  format: "pg_dump custom (-Fc), Postgres 16",
  license: "ODbL-1.0",
  attribution_text: "Lyrics from Unison (https://unison.boidu.dev)",
  enterprise_contact: "enterprise@boidu.dev",
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DownloadsPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  clearAsyncDataCache()
  vi.unstubAllGlobals()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  clearAsyncDataCache()
})

describe("DownloadsPage", () => {
  it("renders the CTA linking to latest_url after the manifest loads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "https://unison-dumps.boidu.dev/dumps/manifest.json") return Promise.resolve(jsonResponse(manifest))
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )
    renderPage()
    const cta = await waitFor(() => screen.getByRole("link", { name: /Download latest dump/i }))
    expect(cta.getAttribute("href")).toBe(manifest.latest_url)
  })

  it("renders formatted row counts after the manifest loads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "https://unison-dumps.boidu.dev/dumps/manifest.json") return Promise.resolve(jsonResponse(manifest))
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText(/184,231 lyrics/)).toBeTruthy())
    expect(screen.getByText(/9,821 requested songs/)).toBeTruthy()
    expect(screen.getByText(/14,502 requests/)).toBeTruthy()
  })

  it("renders the file size in MB or GB after the manifest loads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "https://unison-dumps.boidu.dev/dumps/manifest.json") return Promise.resolve(jsonResponse(manifest))
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText(/100\.0 MB/)).toBeTruthy())
  })

  it("renders the attribution string verbatim", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "https://unison-dumps.boidu.dev/dumps/manifest.json") return Promise.resolve(jsonResponse(manifest))
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText("Lyrics from Unison (https://unison.boidu.dev)")).toBeTruthy())
  })

  it("renders the enterprise mailto link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "https://unison-dumps.boidu.dev/dumps/manifest.json") return Promise.resolve(jsonResponse(manifest))
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )
    renderPage()
    const link = await waitFor(() => screen.getByRole("link", { name: /Email enterprise@boidu\.dev/i }))
    expect(link.getAttribute("href")).toBe(
      "mailto:enterprise@boidu.dev?subject=Unison%20commercial%20license%20inquiry",
    )
  })

  it("shows an error state with the fallback URL when fetch returns a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "https://unison-dumps.boidu.dev/dumps/manifest.json") return Promise.resolve(new Response("nope", { status: 500 }))
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )
    renderPage()
    const fallback = await waitFor(() =>
      screen.getByRole("link", { name: "https://unison-dumps.boidu.dev/latest.dump" }),
    )
    expect(fallback.getAttribute("href")).toBe("https://unison-dumps.boidu.dev/latest.dump")
    expect(screen.queryByRole("link", { name: /Download latest dump/i })).toBeNull()
  })
})
