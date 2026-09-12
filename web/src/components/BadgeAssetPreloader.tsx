import { useAsyncData } from "@/hooks/useAsyncData"
import { usePreloadBadgeAssets } from "@/hooks/usePreloadBadgeAssets"
import { fetchBadgeCatalogue } from "@/lib/api"
import type { BadgeImage } from "@/lib/types"

interface BadgeAssetPreloaderProps {
  variants: (keyof BadgeImage)[]
  fetchPriority?: "high" | "low" | "auto"
}

export function BadgeAssetPreloader({ variants, fetchPriority = "high" }: BadgeAssetPreloaderProps) {
  const state = useAsyncData(fetchBadgeCatalogue, "badges:catalogue")
  usePreloadBadgeAssets(state.status === "success" ? state.data : undefined, variants, fetchPriority)
  return null
}
