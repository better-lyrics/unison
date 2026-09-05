import type { BadgeDef, BadgeImage } from "./types"

export interface BadgeGroup {
  category: string
  badges: BadgeDef[]
}

export function groupBadgesByCategory(badges: BadgeDef[], categoryOrder: string[]): BadgeGroup[] {
  const byCategory = new Map<string, BadgeDef[]>()
  for (const badge of badges) {
    const list = byCategory.get(badge.category)
    if (list) list.push(badge)
    else byCategory.set(badge.category, [badge])
  }

  const groups: BadgeGroup[] = []
  const placed = new Set<string>()
  for (const category of categoryOrder) {
    const list = byCategory.get(category)
    if (list && list.length > 0 && !placed.has(category)) {
      groups.push({ category, badges: list })
      placed.add(category)
    }
  }
  for (const [category, list] of byCategory) {
    if (!placed.has(category)) groups.push({ category, badges: list })
  }
  return groups
}

export function isRareBadge(badge: BadgeDef, rarityThreshold: number): boolean {
  return badge.rarity !== undefined && badge.rarity < rarityThreshold
}

export function resolveBadgeImage(badge: BadgeDef, tier: number | undefined, variant: keyof BadgeImage): string {
  if (tier !== undefined && badge.tiers && badge.tiers.length > 0) {
    const tierImage = badge.tiers[tier - 1]?.image
    if (tierImage) return tierImage[variant]
  }
  return badge.image[variant]
}
