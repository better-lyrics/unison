const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
})

const exactFormatter = new Intl.NumberFormat("en-US")

const shortDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })

export function formatRank(rank: number): string {
  return `#${rank}`
}

export function formatCompact(n: number): string {
  return compactFormatter.format(n)
}

export function formatExact(n: number): string {
  return exactFormatter.format(n)
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function formatShortDate(epochSec: number): string {
  return shortDateFormatter.format(epochSec * 1000)
}

const MINUTE = 60
const HOUR = 3600
const DAY = 86400

export function formatElapsed(seconds: number): string {
  if (seconds < HOUR) return `${Math.max(1, Math.round(seconds / MINUTE))}m`
  if (seconds < DAY) return `${Math.round(seconds / HOUR)}h`
  if (seconds < 14 * DAY) return `${Math.round(seconds / DAY)}d`
  return `${Math.round(seconds / (7 * DAY))}w`
}

export function formatRemaining(seconds: number): string {
  const s = Math.max(0, seconds)
  const days = Math.floor(s / DAY)
  const hours = Math.floor((s % DAY) / HOUR)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h`
  return `${Math.floor(s / MINUTE)}m`
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return ""
  const total = Math.floor(seconds)
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

export function formatRelativeTime(epochSec: number): string {
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" })
  const diffSec = epochSec - Math.floor(Date.now() / 1000)
  const absSec = Math.abs(diffSec)
  if (absSec < 60) return rtf.format(diffSec, "second")
  if (absSec < 3600) return rtf.format(Math.round(diffSec / 60), "minute")
  if (absSec < 86400) return rtf.format(Math.round(diffSec / 3600), "hour")
  if (absSec < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), "day")
  if (absSec < 86400 * 365) return rtf.format(Math.round(diffSec / (86400 * 30)), "month")
  return rtf.format(Math.round(diffSec / (86400 * 365)), "year")
}
