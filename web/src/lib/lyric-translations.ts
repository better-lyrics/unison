import type { Lyric } from "@braccato/parsers"

export function translationLanguages(lyrics: Lyric[]): string[] {
  return [...new Set(lyrics.flatMap((line) => Object.keys(line.translations ?? {})))]
}

export function pickTranslationLanguage(languages: string[], picked?: string): string | undefined {
  return picked && languages.includes(picked) ? picked : languages[0]
}
