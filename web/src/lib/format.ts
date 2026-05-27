const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
})

const exactFormatter = new Intl.NumberFormat("en-US")

export function formatRank(rank: number): string {
  return `#${rank}`
}

export function formatCompact(n: number): string {
  return compactFormatter.format(n)
}

export function formatExact(n: number): string {
  return exactFormatter.format(n)
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
