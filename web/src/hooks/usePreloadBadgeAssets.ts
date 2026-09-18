import { useEffect } from "react"
import { preload } from "react-dom"
import { collectBadgeAssetUrls } from "@/lib/badge-view"
import type { BadgeCatalogue, BadgeImage } from "@/lib/types"

export function usePreloadBadgeAssets(
  catalogue: BadgeCatalogue | undefined,
  variants: (keyof BadgeImage)[],
  fetchPriority: "high" | "low" | "auto",
  mapUrl?: (url: string) => string,
): void {
  useEffect(() => {
    if (!catalogue) return
    for (const url of collectBadgeAssetUrls(catalogue, variants)) {
      preload(mapUrl ? mapUrl(url) : url, { as: "image", fetchPriority })
    }
  }, [catalogue, variants, fetchPriority, mapUrl])
}
