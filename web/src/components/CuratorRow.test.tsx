import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BadgeCatalogueProvider } from "@/components/BadgeCatalogueContext"
import { CuratorRow } from "@/components/CuratorRow"
import { clearAsyncDataCache } from "@/hooks/useAsyncData"
import { seedBadgeCatalogue } from "@/lib/dev-seed"
import type { CuratorLeaderboardEntry } from "@/lib/types"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function entry(overrides: Partial<CuratorLeaderboardEntry>): CuratorLeaderboardEntry {
  return {
    keyId: "a".repeat(64),
    displayName: "Aurora",
    reputation: 1,
    score: 10,
    submissionCount: 5,
    totalUpvotes: 20,
    rank: 1,
    discordLinked: false,
    ...overrides,
  }
}

async function renderRow(e: CuratorLeaderboardEntry) {
  const catalogue = await seedBadgeCatalogue()
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ success: true, data: catalogue })))
  render(
    <MemoryRouter>
      <BadgeCatalogueProvider>
        <ul>
          <CuratorRow entry={e} />
        </ul>
      </BadgeCatalogueProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  clearAsyncDataCache()
})

describe("CuratorRow", () => {
  it("shows a tier gem in place of the rank for a top-3 finisher", async () => {
    await renderRow(entry({ rank: 1, tier: "legendary", topBadge: { key: "most-loved", name: "Most Loved" }, badgeCount: 3 }))
    await waitFor(() => expect(screen.getByText("Rank 1")).toBeTruthy())
    expect(screen.getByAltText("Most Loved")).toBeTruthy()
    expect(screen.getByText("+2")).toBeTruthy()
  })

  it("keeps a numeric rank beyond the podium", async () => {
    await renderRow(entry({ rank: 4, tier: "elite" }))
    await waitFor(() => expect(screen.getByText("#4")).toBeTruthy())
    expect(screen.queryByText("Rank 4")).toBeNull()
  })

  it("renders the Discord cutout only when linked", async () => {
    await renderRow(entry({ rank: 4, discordLinked: true }))
    await waitFor(() => expect(screen.getByText("Discord connected")).toBeTruthy())
  })

  it("shows the community star instead of a rank", async () => {
    await renderRow(entry({ rank: 0, community: true, tier: null }))
    await waitFor(() => expect(screen.getByText("Community account")).toBeTruthy())
    expect(screen.queryByText("#0")).toBeNull()
  })
})
