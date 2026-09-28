import type { BoostQuota } from "./council-types"
import { plural } from "./format"

type Subject = "you" | "member"

export function quotaBasisText({ quota, basis }: BoostQuota, subject: Subject = "you"): string {
  const month = new Date(basis.monthStart * 1000).toLocaleString("en-US", { month: "long", timeZone: "UTC" })
  if (!basis.active) {
    return subject === "you"
      ? `None of your ${month} lyrics count, so this month's quota is reduced. Submit lyrics this month to lift next month's.`
      : `None of their ${month} lyrics count, so this month's quota is reduced.`
  }
  const base = quota - basis.bonus
  if (basis.bonus === 0) {
    return subject === "you"
      ? `${base} base. Your upvoted lyrics this month add seals next month.`
      : `${base} base, nothing earned from ${month}.`
  }
  return `${base} base + ${basis.bonus} earned from ${plural(basis.upvotedLyrics, "upvoted lyric", "upvoted lyrics")} in ${month}.`
}

export function quotaRuleText({ rule }: BoostQuota): string {
  const every = rule.upvotedLyricsPerSeal === 1 ? "every lyric" : `every ${rule.upvotedLyricsPerSeal} of those lyrics`
  return `Each month: ${rule.base} seals if you submitted lyrics the month before, ${rule.inactive} if not, plus 1 for ${every} that got upvoted, up to ${rule.max}. New members get ${rule.base} for their first two months.`
}

export function quotaExplanation(quota: BoostQuota, subject: Subject = "you"): string {
  return `${quotaBasisText(quota, subject)} ${quotaRuleText(quota)}`
}
