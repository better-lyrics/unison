export function formatRank(rank: number): string {
  return `#${rank}`
}

export function formatVotes(n: number): string {
  if (n < 1000) return String(n)
  const k = n / 1000
  return `${k.toFixed(1)}k`
}
