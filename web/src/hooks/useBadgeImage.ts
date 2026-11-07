import { useBadgeCatalogueOptional } from "@/components/BadgeCatalogueContext"
import { resolveBadgeImage } from "@/lib/badge-view"
import type { BadgeImage } from "@/lib/types"

export function useBadgeImage(): (key: string, tier?: number, variant?: keyof BadgeImage) => string | null {
  const catalogue = useBadgeCatalogueOptional()
  const cat = catalogue?.status === "success" ? catalogue.data : null
  return (key, tier, variant = "color") => {
    const def = cat?.badges.find((d) => d.key === key)
    return def ? resolveBadgeImage(def, tier, variant) : null
  }
}

export interface BadgeArtImage {
  src: string
  silhouette: string | null
}

export function useBadgeArt(): (key: string, tier?: number) => BadgeArtImage | null {
  const badgeImage = useBadgeImage()
  return (key, tier) => {
    const src = badgeImage(key, tier)
    return src ? { src, silhouette: badgeImage(key, tier, "silhouette") } : null
  }
}
