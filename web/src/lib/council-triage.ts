import type { BookmarkView, EditItem, QueueItem } from "./council-types"

export type BookmarkState =
  | { kind: "mine" }
  | { kind: "open"; capped: boolean; cap: number }
  | { kind: "other"; holder: string }

export interface TriageGroups<T> {
  mine: T[]
  open: T[]
  others: T[]
}

export function activeBookmark(item: { bookmark: BookmarkView | null }, now: number): BookmarkView | null {
  return item.bookmark !== null && item.bookmark.expiresAt > now ? item.bookmark : null
}

export function openItems<T extends { bookmark: BookmarkView | null }>(items: T[], now: number): T[] {
  return items.filter((item) => activeBookmark(item, now) === null)
}

export function groupByBookmark<T extends { bookmark: BookmarkView | null }>(
  items: T[],
  meKeyId: string,
  now: number,
): TriageGroups<T> {
  const groups: TriageGroups<T> = { mine: [], open: [], others: [] }
  for (const item of items) {
    const held = activeBookmark(item, now)
    if (!held) groups.open.push(item)
    else if (held.holder.keyId === meKeyId) groups.mine.push(item)
    else groups.others.push(item)
  }
  return groups
}

export type QueueSort = "top" | "votes" | "waiting"

const SORTS: Record<QueueSort, (a: QueueItem, b: QueueItem) => number> = {
  top: (a, b) => b.score - a.score || b.voteCount - a.voteCount,
  votes: (a, b) => b.voteCount - a.voteCount,
  waiting: (a, b) => a.createdAt - b.createdAt,
}

export function sortQueue(items: QueueItem[], sort: QueueSort): QueueItem[] {
  return [...items].sort(SORTS[sort])
}

export type QueueFilter = "all" | "flags" | (string & {})

function matches(text: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = text.trim().toLocaleLowerCase()
  return needle === "" || fields.some((f) => f?.toLocaleLowerCase().includes(needle))
}

export function filterQueue(items: QueueItem[], { text, filter }: { text: string; filter: QueueFilter }): QueueItem[] {
  return items.filter((item) => {
    if (filter === "flags" && item.flags.length === 0) return false
    if (filter !== "all" && filter !== "flags" && item.language !== filter) return false
    return matches(text, item.song, item.artist, item.submitter?.displayName)
  })
}

const MAX_LANGUAGE_FILTERS = 4

export function languageFilters(items: QueueItem[]): string[] {
  const counts = new Map<string, number>()
  for (const { language } of items) if (language) counts.set(language, (counts.get(language) ?? 0) + 1)
  return [...counts]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, MAX_LANGUAGE_FILTERS)
    .map(([language]) => language)
}

export function filterEdits(items: EditItem[], text: string): EditItem[] {
  return items
    .filter((e) => matches(text, e.song, e.artist, e.author?.displayName))
    .sort((a, b) => a.createdAt - b.createdAt)
}

export function splitNew(known: ReadonlySet<string>, keys: string[]): string[] {
  return keys.filter((key) => !known.has(key))
}

export function neighbour(keys: string[], current: string | null, step: 1 | -1): string | null {
  if (keys.length === 0) return null
  const at = current === null ? -1 : keys.indexOf(current)
  if (at === -1) return keys[0]
  return keys[Math.min(keys.length - 1, Math.max(0, at + step))]
}
