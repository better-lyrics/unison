export const COMPOSER_URL = "https://composer.betterlyrics.org"

export function composerLyricUrl(lyricId: number): string {
  const url = new URL("/", COMPOSER_URL)
  url.searchParams.set("unisonLyric", String(lyricId))
  return url.toString()
}
