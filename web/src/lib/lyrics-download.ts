import type { LyricsFormat } from "@/lib/types"

export const EXTENSION_BY_FORMAT: Record<LyricsFormat, string> = {
  ttml: "ttml",
  lrc: "lrc",
  plain: "txt",
}

export const MIME_BY_FORMAT: Record<LyricsFormat, string> = {
  ttml: "application/xml;charset=utf-8",
  lrc: "text/plain;charset=utf-8",
  plain: "text/plain;charset=utf-8",
}

const INVALID_FILENAME_CHARS = /[/\\:*?"<>|]/g

export function sanitizeFilename(name: string): string {
  const collapsed = name.replace(/\s+/g, " ")
  let printable = ""
  for (const ch of collapsed) {
    const code = ch.codePointAt(0) ?? 0
    if (code >= 0x20 && code !== 0x7f) printable += ch
  }
  return printable
    .replace(INVALID_FILENAME_CHARS, "")
    .replace(/^[\s.]+/, "")
    .replace(/[\s.]+$/, "")
}

export function lyricsFilename(v: {
  song: string
  artist: string
  videoId: string
  format: LyricsFormat
}): string {
  const song = v.song.trim()
  const artist = v.artist.trim()
  const base = song && artist ? `${song} - ${artist}` : song || artist || v.videoId
  const safe = sanitizeFilename(base) || sanitizeFilename(v.videoId) || "lyrics"
  return `${safe}.${EXTENSION_BY_FORMAT[v.format]}`
}
