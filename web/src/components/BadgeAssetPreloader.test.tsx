import { cleanup, render, waitFor } from "@testing-library/react"
import { preload } from "react-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { clearAsyncDataCache } from "@/hooks/useAsyncData"
import { fetchBadgeCatalogue } from "@/lib/api"
import type { BadgeCatalogue } from "@/lib/types"
import { BadgeAssetPreloader } from "./BadgeAssetPreloader"

vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  preload: vi.fn(),
}))

vi.mock("@/lib/api", () => ({
  fetchBadgeCatalogue: vi.fn(),
}))

const catalogue: BadgeCatalogue = {
  badges: [
    {
      key: "a",
      name: "A",
      description: "A",
      category: "output",
      kind: "medal",
      image: { color: "/a-color.svg", mono: "/a-mono.svg", silhouette: "/a-sil.svg" },
    },
  ],
  display: { inlineGlyphs: 3, featuredMax: 3, rarityThreshold: 0.1, categoryOrder: [] },
}

beforeEach(() => {
  clearAsyncDataCache()
  vi.mocked(preload).mockClear()
  vi.mocked(fetchBadgeCatalogue).mockResolvedValue(catalogue)
})

afterEach(() => cleanup())

describe("BadgeAssetPreloader", () => {
  it("preloads the requested variants at the given priority once the catalogue loads", async () => {
    render(<BadgeAssetPreloader variants={["color"]} fetchPriority="high" />)
    await waitFor(() => expect(preload).toHaveBeenCalledWith("/a-color.svg", { as: "image", fetchPriority: "high" }))
    expect(preload).not.toHaveBeenCalledWith("/a-mono.svg", expect.anything())
    expect(preload).not.toHaveBeenCalledWith("/a-sil.svg", expect.anything())
  })

  it("renders nothing", () => {
    const { container } = render(<BadgeAssetPreloader variants={["color"]} />)
    expect(container.firstChild).toBeNull()
  })
})
