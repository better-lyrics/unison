import { useBadgeCatalogueOptional } from "@/components/BadgeCatalogueContext"
import { resolveBadgeImage } from "@/lib/badge-view"

export function useBadgeImage(): (key: string, tier?: number) => string | null {
  const catalogue = useBadgeCatalogueOptional()
  const cat = catalogue?.status === "success" ? catalogue.data : null
  return (key, tier) => {
    const def = cat?.badges.find((d) => d.key === key)
    return def ? resolveBadgeImage(def, tier, "color") : null
  }
}
