import type { BoostQuota } from "./council-types"
import { plural } from "./format"

export function quotaBasisText({ quota, basis }: BoostQuota): string {
  const month = new Date(basis.monthStart * 1000).toLocaleString("en-US", { month: "long", timeZone: "UTC" })
  if (!basis.active) {
    return `No lyrics in ${month}, so this month's quota is reduced. Submit lyrics this month to lift next month's.`
  }
  const base = quota - basis.bonus
  if (basis.bonus === 0) return `${base} base. Your upvoted lyrics this month add seals next month.`
  return `${base} base + ${basis.bonus} earned from ${plural(basis.upvotedLyrics, "upvoted lyric", "upvoted lyrics")} in ${month}.`
}
