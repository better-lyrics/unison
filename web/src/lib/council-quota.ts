import type { BoostQuota } from "./council-types"
import { plural } from "./format"

type Subject = "you" | "member"

export function quotaBasisText({ quota, basis }: BoostQuota, subject: Subject = "you"): string {
  const month = new Date(basis.monthStart * 1000).toLocaleString("en-US", { month: "long", timeZone: "UTC" })
  if (!basis.active) {
    return subject === "you"
      ? `None of your ${month} lyrics count, so you have fewer seals this month. Submit lyrics now to get more next month.`
      : `None of their ${month} lyrics count, so they have fewer seals this month.`
  }
  const base = quota - basis.bonus
  if (basis.bonus === 0) {
    return subject === "you"
      ? `${base} base. Upvoted lyrics you submit this month add seals next month.`
      : `${base} base, nothing earned from ${month}.`
  }
  return `${base} base, plus ${basis.bonus} earned from ${plural(basis.upvotedLyrics, "upvoted lyric", "upvoted lyrics")} in ${month}.`
}

export function quotaRuleText({ rule }: BoostQuota): string {
  const earn =
    rule.upvotedLyricsPerSeal === 1
      ? "Each of those that got upvoted adds 1 more"
      : `Every ${rule.upvotedLyricsPerSeal} of those that got upvoted add 1 more`
  return `You get ${rule.base} seals a month if at least one of your lyrics from last month still counts (not removed, hidden or rejected), or ${rule.inactive} if none do. ${earn}, up to ${rule.max}. New members count as active in the month they join and the next one.`
}

export function quotaExplanation(quota: BoostQuota, subject: Subject = "you"): string {
  return `${quotaBasisText(quota, subject)} ${quotaRuleText(quota)}`
}
