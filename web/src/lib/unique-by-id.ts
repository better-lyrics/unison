export function uniqueById<T extends { id: number }>(items: readonly T[]): T[] {
  const seen = new Set<number>()
  return items.filter((item) => !seen.has(item.id) && seen.add(item.id))
}
