import { createContext, type ReactNode, useContext } from "react"
import { useAsyncData } from "@/hooks/useAsyncData"
import { usePreloadBadgeAssets } from "@/hooks/usePreloadBadgeAssets"
import { fetchBadgeCatalogue } from "@/lib/api"
import type { BadgeCatalogue, BadgeImage } from "@/lib/types"

type CatalogueState =
  | { status: "loading"; data: undefined; error: undefined }
  | { status: "success"; data: BadgeCatalogue; error: undefined }
  | { status: "error"; data: undefined; error: Error }

// Color is preloaded app-wide; these glyphs only appear on badge pages, so they load lazily here.
const GLYPH_VARIANTS: (keyof BadgeImage)[] = ["mono", "silhouette"]

const BadgeCatalogueContext = createContext<CatalogueState | null>(null)

export function BadgeCatalogueProvider({ children }: { children: ReactNode }) {
  const state = useAsyncData<BadgeCatalogue>(fetchBadgeCatalogue, "badges:catalogue")
  usePreloadBadgeAssets(state.status === "success" ? state.data : undefined, GLYPH_VARIANTS, "low")
  return <BadgeCatalogueContext.Provider value={state}>{children}</BadgeCatalogueContext.Provider>
}

export function useBadgeCatalogue(): CatalogueState {
  const ctx = useContext(BadgeCatalogueContext)
  if (ctx === null) {
    throw new Error("useBadgeCatalogue must be used within a BadgeCatalogueProvider")
  }
  return ctx
}

// Non-throwing variant for components (like CuratorRow) that render both inside
// and outside a provider and degrade gracefully when the catalogue is absent.
export function useBadgeCatalogueOptional(): CatalogueState | null {
  return useContext(BadgeCatalogueContext)
}
