import type { MetadataItem, SongMetadata } from "./council-types"

export type MetadataField = "Title" | "Artist" | "Album"

const FIELDS: [MetadataField, keyof SongMetadata][] = [
  ["Title", "song"],
  ["Artist", "artist"],
  ["Album", "album"],
]

export function changedFields(item: Pick<MetadataItem, "before" | "proposed">): MetadataField[] {
  return FIELDS.filter(([, key]) => item.before[key] !== item.proposed[key]).map(([label]) => label)
}

export function metadataValue(item: Pick<MetadataItem, "before" | "proposed">, field: MetadataField) {
  const key = FIELDS.find(([label]) => label === field)?.[1] ?? "song"
  return { before: item.before[key], proposed: item.proposed[key] }
}
