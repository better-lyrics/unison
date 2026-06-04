import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it } from "vitest"
import type { VariantFull } from "@/lib/types"
import { VariantMetadata } from "./VariantMetadata"

afterEach(() => cleanup())

function makeVariant(overrides: Partial<VariantFull> = {}): VariantFull {
  return {
    id: 1,
    videoId: "vid",
    song: "Midnight City",
    artist: "M83",
    format: "ttml",
    syncType: "richsync",
    score: 12,
    effectiveScore: 12.4,
    voteCount: 9,
    confidence: "high",
    hidden: false,
    lyrics: "<tt></tt>",
    ...overrides,
  }
}

function renderMeta(variant: VariantFull) {
  return render(
    <MemoryRouter>
      <VariantMetadata variant={variant} />
    </MemoryRouter>,
  )
}

describe("VariantMetadata", () => {
  it("renders song and artist", () => {
    renderMeta(makeVariant())
    expect(screen.getByText("Midnight City")).toBeTruthy()
    expect(screen.getByText("M83")).toBeTruthy()
  })

  it("renders the album when present", () => {
    renderMeta(makeVariant({ album: "Hurry Up, We're Dreaming" }))
    expect(screen.getByText("Hurry Up, We're Dreaming")).toBeTruthy()
  })

  it("omits the album row when album is missing", () => {
    renderMeta(makeVariant())
    expect(screen.queryByText(/Album/i)).toBeNull()
  })

  it("renders ISRC and language when present", () => {
    renderMeta(makeVariant({ isrc: "USRC12345678", language: "en" }))
    expect(screen.getByText("USRC12345678")).toBeTruthy()
    expect(screen.getByText("en")).toBeTruthy()
  })

  it("omits ISRC and language rows when missing", () => {
    renderMeta(makeVariant())
    expect(screen.queryByText(/ISRC/i)).toBeNull()
    expect(screen.queryByText(/Language/i)).toBeNull()
  })

  it("renders the uppercase format", () => {
    renderMeta(makeVariant({ format: "lrc" }))
    expect(screen.getByText("LRC")).toBeTruthy()
  })

  it("renders the sync type as-is", () => {
    renderMeta(makeVariant({ syncType: "linesync" }))
    expect(screen.getByText("linesync")).toBeTruthy()
  })

  it("renders the effective score with one decimal and the raw score in parentheses", () => {
    renderMeta(makeVariant({ score: 12, effectiveScore: 12.42 }))
    expect(screen.getByText(/12\.4/)).toBeTruthy()
    expect(screen.getByText(/\(12\)/)).toBeTruthy()
  })

  it("shows an up arrow for an upvoted user vote", () => {
    renderMeta(makeVariant({ userVote: 1 }))
    expect(screen.getByText(/▲/)).toBeTruthy()
  })

  it("shows a down arrow for a downvoted user vote", () => {
    renderMeta(makeVariant({ userVote: -1 }))
    expect(screen.getByText(/▼/)).toBeTruthy()
  })

  it("shows neither arrow when userVote is null or missing", () => {
    renderMeta(makeVariant({ userVote: null }))
    expect(screen.queryByText(/▲/)).toBeNull()
    expect(screen.queryByText(/▼/)).toBeNull()
  })

  it("renders the confidence label", () => {
    renderMeta(makeVariant({ confidence: "low" }))
    expect(screen.getByText("low")).toBeTruthy()
  })

  it("renders the submitter row with a truncated keyId and link", () => {
    const keyId = "abcdef0123456789012345678901wxyz"
    renderMeta(makeVariant({ submitter: { keyId, reputation: 1.3 } }))
    const link = screen.getByRole("link")
    expect(link.getAttribute("href")).toBe(`/users/${keyId}`)
    expect(link.textContent).toContain("abcdef01")
    expect(link.textContent).toContain("wxyz")
    expect(screen.getByText(/1\.3/)).toBeTruthy()
  })

  it("omits the submitter row when absent", () => {
    renderMeta(makeVariant())
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("renders the hidden warning banner when hidden is true", () => {
    renderMeta(makeVariant({ hidden: true }))
    expect(screen.getByText(/auto-hidden by community downvotes/i)).toBeTruthy()
  })

  it("omits the hidden banner when hidden is false", () => {
    renderMeta(makeVariant({ hidden: false }))
    expect(screen.queryByText(/auto-hidden/i)).toBeNull()
  })
})
