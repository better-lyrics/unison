import { renderHook } from "@testing-library/react"
import { preload } from "react-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BadgeCatalogue } from "@/lib/types"
import { usePreloadBadgeAssets } from "./usePreloadBadgeAssets"

vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  preload: vi.fn(),
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

beforeEach(() => vi.mocked(preload).mockClear())
afterEach(() => vi.clearAllMocks())

describe("usePreloadBadgeAssets", () => {
  it("preloads only the requested variants at the given priority", () => {
    renderHook(() => usePreloadBadgeAssets(catalogue, ["color"], "high"))
    expect(preload).toHaveBeenCalledWith("/a-color.svg", { as: "image", fetchPriority: "high" })
    expect(preload).not.toHaveBeenCalledWith("/a-mono.svg", expect.anything())
    expect(preload).not.toHaveBeenCalledWith("/a-sil.svg", expect.anything())
  })

  it("preloads the glyph variants at low priority", () => {
    renderHook(() => usePreloadBadgeAssets(catalogue, ["mono", "silhouette"], "low"))
    expect(preload).toHaveBeenCalledWith("/a-mono.svg", { as: "image", fetchPriority: "low" })
    expect(preload).toHaveBeenCalledWith("/a-sil.svg", { as: "image", fetchPriority: "low" })
    expect(preload).not.toHaveBeenCalledWith("/a-color.svg", expect.anything())
  })

  it("does nothing until the catalogue is available", () => {
    renderHook(() => usePreloadBadgeAssets(undefined, ["color"], "high"))
    expect(preload).not.toHaveBeenCalled()
  })
})
