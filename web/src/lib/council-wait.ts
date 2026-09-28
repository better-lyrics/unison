const DAY = 86400

const RANGES: [label: string, below: number][] = [
  ["Under 1d", DAY],
  ["1 to 3d", 3 * DAY],
  ["3 to 7d", 7 * DAY],
  ["1 to 2w", 14 * DAY],
  ["Over 2w", Number.POSITIVE_INFINITY],
]

export function waitBuckets(since: number[], now: number): { label: string; value: number }[] {
  const counts = RANGES.map(() => 0)
  for (const at of since) counts[RANGES.findIndex(([, below]) => now - at < below)]++
  return RANGES.map(([label], i) => ({ label, value: counts[i] }))
}
