export function chartMax(values: number[], floor = 4): number {
  return Math.max(floor, ...values)
}

export function axisTicks(max: number): number[] {
  return [...new Set([0, Math.round(max / 2), max])]
}

export function roundedTopPath(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0 || w <= 0) return ""
  const radius = Math.min(r, h, w / 2)
  return `M${x},${y + h}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + w - radius}Q${x + w},${y} ${x + w},${y + radius}V${y + h}Z`
}
