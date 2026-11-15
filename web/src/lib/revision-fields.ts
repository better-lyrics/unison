import { languageName } from "./language"
import type { FieldCheck } from "./revision-types"

export type RevisionField = FieldCheck["field"]

export const FIELD_LABEL: Record<RevisionField, string> = {
  lyrics: "Lyrics",
  language: "Language",
  isrc: "ISRC",
  album: "Album",
}

export function fieldValueText(field: RevisionField, value: string | null): string {
  if (value === null || value === "") return "none"
  return field === "language" ? languageName(value) : value
}
