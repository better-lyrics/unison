import { createContext, type ReactNode, useContext } from "react"
import { useAsyncData } from "@/hooks/useAsyncData"
import { usePreloadBadgeAssets } from "@/hooks/usePreloadBadgeAssets"
import { fetchBadgeCatalogue } from "@/lib/api"
import { transparentBadgeUrl } from "@/lib/badge-view"
import type { BadgeCatalogue, BadgeImage } from "@/lib/types"

type CatalogueState =
  | { status: "loading"; data: undefined; error: undefined }
  | { status: "success"; data: BadgeCatalogue; error: undefined }
  | { status: "error"; data: undefined; error: Error }

// Color is preloaded app-wide; the mono (locked) glyph only appears on badge pages, so it loads
// lazily here. The background is baked into color/mono server-side, so the silhouette is never fetched.
const GLYPH_VARIANTS: (keyof BadgeImage)[] = ["mono"]

// The badge modal blurs a transparent (bg=none) copy of the color/mono art into a glow, so preload
// those so the aura is ready the moment the modal opens instead of popping in after.
const GLOW_VARIANTS: (keyof BadgeImage)[] = ["color", "mono"]

const BadgeCatalogueContext = createContext<CatalogueState | null>(null)

export function BadgeCatalogueProvider({ children }: { children: ReactNode }) {
  const state = useAsyncData<BadgeCatalogue>(fetchBadgeCatalogue, "badges:catalogue")
  const data = state.status === "success" ? state.data : undefined
  usePreloadBadgeAssets(data, GLYPH_VARIANTS, "low")
  usePreloadBadgeAssets(data, GLOW_VARIANTS, "low", transparentBadgeUrl)
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
