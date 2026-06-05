import type {
  LyricsFormat,
  LyricsSearchHit,
  QueueEntry,
  SongLeaderboardEntry,
  SongsLeaderboardResponse,
  SyncType,
  VariantFull,
  VariantSummary,
} from "./types"

export { getSeedSession } from "./seed-flag"

const SEEDED_SUBMITTERS = [
  { keyId: "1".repeat(64), reputation: 1.8 },
  { keyId: "2".repeat(64), reputation: 1.4 },
  { keyId: "3".repeat(64), reputation: 1.1 },
  { keyId: "4".repeat(64), reputation: 0.9 },
  { keyId: "5".repeat(64), reputation: 0.6 },
] as const

interface VariantTemplate {
  id: number
  videoId: string
  song: string
  artist: string
  album?: string
  isrc?: string
  format: LyricsFormat
  syncType: SyncType
  language?: string
  score: number
  effectiveScore: number
  voteCount: number
  confidence: "low" | "medium" | "high"
  hidden: boolean
  submitterIdx?: number
  userVote: 1 | -1 | null
  lyricsLines: string[]
}

const SEED_TEMPLATES: VariantTemplate[] = [
  {
    id: 1001,
    videoId: "vidA01abcde",
    song: "Midnight in the City",
    artist: "The Constellations",
    album: "Lantern Hours",
    format: "ttml",
    syncType: "richsync",
    language: "en",
    score: 18.2,
    effectiveScore: 21.4,
    voteCount: 24,
    confidence: "high",
    hidden: false,
    submitterIdx: 0,
    userVote: 1,
    lyricsLines: [
      "Verse line one in midnight haze",
      "Verse line two the city stays",
      "Chorus line one we drift away",
      "Chorus line two until the day",
      "Bridge line one a quiet glow",
      "Bridge line two the rivers flow",
    ],
  },
  {
    id: 1002,
    videoId: "vidA01abcde",
    song: "Midnight in the City",
    artist: "The Constellations",
    album: "Lantern Hours",
    format: "lrc",
    syncType: "linesync",
    language: "en",
    score: 12.1,
    effectiveScore: 13.0,
    voteCount: 11,
    confidence: "medium",
    hidden: false,
    submitterIdx: 1,
    userVote: null,
    lyricsLines: [
      "Verse line one transcribed by hand",
      "Verse line two across the land",
      "Chorus line one a steady beat",
      "Chorus line two on every street",
    ],
  },
  {
    id: 1003,
    videoId: "vidA01abcde",
    song: "Midnight in the City",
    artist: "The Constellations",
    format: "plain",
    syncType: "plain",
    score: 4.5,
    effectiveScore: 4.2,
    voteCount: 6,
    confidence: "low",
    hidden: false,
    userVote: -1,
    lyricsLines: [
      "Verse line one untimed",
      "Verse line two no markers",
      "Chorus line one plain text only",
      "Chorus line two for completeness",
    ],
  },
  {
    id: 1004,
    videoId: "vidA01abcde",
    song: "Midnight in the City",
    artist: "The Constellations",
    format: "plain",
    syncType: "plain",
    score: 0.5,
    effectiveScore: 0.3,
    voteCount: 2,
    confidence: "low",
    hidden: true,
    submitterIdx: 4,
    userVote: null,
    lyricsLines: [
      "Verse line one flagged variant",
      "Verse line two hidden body",
      "Chorus line one only visible behind banner",
      "Chorus line two preserved for moderation",
    ],
  },
  {
    id: 1005,
    videoId: "vidA02fghij",
    song: "Paper Boats",
    artist: "Indigo Falls",
    album: "Riverbed",
    format: "ttml",
    syncType: "richsync",
    language: "en",
    score: 9.4,
    effectiveScore: 10.2,
    voteCount: 14,
    confidence: "high",
    hidden: false,
    submitterIdx: 2,
    userVote: 1,
    lyricsLines: [
      "Verse line one folded into shape",
      "Verse line two cast upon the lake",
      "Chorus line one a paper sail",
      "Chorus line two on every trail",
    ],
  },
  {
    id: 1006,
    videoId: "vidA03klmno",
    song: "Ten Cent Sun",
    artist: "Marrow & Knox",
    format: "lrc",
    syncType: "linesync",
    language: "en",
    score: 7.0,
    effectiveScore: 7.6,
    voteCount: 9,
    confidence: "medium",
    hidden: false,
    submitterIdx: 3,
    userVote: null,
    lyricsLines: [
      "Verse line one a copper sky",
      "Verse line two we wandered by",
      "Chorus line one ten cent sun",
      "Chorus line two the day is done",
    ],
  },
  {
    id: 1007,
    videoId: "vidA04pqrst",
    song: "Long Drive Home",
    artist: "Halcyon Bren",
    album: "Off Hours",
    format: "ttml",
    syncType: "richsync",
    language: "en",
    score: 11.3,
    effectiveScore: 12.0,
    voteCount: 16,
    confidence: "high",
    hidden: false,
    userVote: null,
    lyricsLines: [
      "Verse line one a quiet road",
      "Verse line two a heavy load",
      "Chorus line one a long way home",
      "Chorus line two we drive alone",
    ],
  },
  {
    id: 1008,
    videoId: "vidA05uvwxy",
    song: "Glass Harbor",
    artist: "Aurora Wynter",
    album: "Tideline",
    format: "ttml",
    syncType: "richsync",
    language: "en",
    score: 14.8,
    effectiveScore: 16.1,
    voteCount: 19,
    confidence: "high",
    hidden: false,
    submitterIdx: 0,
    userVote: 1,
    lyricsLines: [
      "Verse line one a quiet shore",
      "Verse line two we asked for more",
      "Chorus line one a glass harbor",
      "Chorus line two no farther",
    ],
  },
  {
    id: 1009,
    videoId: "vidA05uvwxy",
    song: "Glass Harbor",
    artist: "Aurora Wynter",
    album: "Tideline",
    format: "lrc",
    syncType: "linesync",
    language: "en",
    score: 8.1,
    effectiveScore: 8.4,
    voteCount: 10,
    confidence: "medium",
    hidden: false,
    submitterIdx: 1,
    userVote: -1,
    lyricsLines: [
      "Verse line one a slower take",
      "Verse line two for memory sake",
      "Chorus line one a glass harbor",
      "Chorus line two an open door",
    ],
  },
  {
    id: 1010,
    videoId: "vidA05uvwxy",
    song: "Glass Harbor",
    artist: "Aurora Wynter",
    format: "plain",
    syncType: "plain",
    score: 2.0,
    effectiveScore: 1.9,
    voteCount: 3,
    confidence: "low",
    hidden: false,
    userVote: null,
    lyricsLines: [
      "Verse line one written out",
      "Verse line two without a doubt",
      "Chorus line one a glass harbor",
      "Chorus line two and nothing more",
    ],
  },
  {
    id: 1011,
    videoId: "vidA06zabcd",
    song: "Midnight Loops",
    artist: "Stein & Quill",
    format: "plain",
    syncType: "plain",
    score: 6.2,
    effectiveScore: 6.8,
    voteCount: 8,
    confidence: "medium",
    hidden: false,
    submitterIdx: 2,
    userVote: null,
    lyricsLines: [
      "Verse line one repeats the past",
      "Verse line two but cannot last",
      "Chorus line one midnight loops",
      "Chorus line two in tighter groups",
    ],
  },
  {
    id: 1012,
    videoId: "vidA07efghi",
    song: "Cassia Bloom",
    artist: "Cassia Vale",
    album: "First Spring",
    format: "ttml",
    syncType: "richsync",
    language: "en",
    score: 13.5,
    effectiveScore: 15.0,
    voteCount: 18,
    confidence: "high",
    hidden: false,
    submitterIdx: 3,
    userVote: 1,
    lyricsLines: [
      "Verse line one a slow unfold",
      "Verse line two the season told",
      "Chorus line one cassia bloom",
      "Chorus line two beyond the room",
    ],
  },
  {
    id: 1013,
    videoId: "vidA08jklmn",
    song: "Wynter Static",
    artist: "Greta Knox",
    format: "lrc",
    syncType: "linesync",
    language: "en",
    score: 5.6,
    effectiveScore: 5.9,
    voteCount: 7,
    confidence: "medium",
    hidden: false,
    submitterIdx: 4,
    userVote: null,
    lyricsLines: [
      "Verse line one a dial tone hum",
      "Verse line two we're going numb",
      "Chorus line one wynter static",
      "Chorus line two automatic",
    ],
  },
  {
    id: 1014,
    videoId: "vidA08jklmn",
    song: "Wynter Static",
    artist: "Greta Knox",
    format: "plain",
    syncType: "plain",
    score: 1.4,
    effectiveScore: 1.2,
    voteCount: 4,
    confidence: "low",
    hidden: false,
    userVote: null,
    lyricsLines: [
      "Verse line one as plain text",
      "Verse line two for the next",
      "Chorus line one wynter static",
      "Chorus line two emphatic",
    ],
  },
  {
    id: 1015,
    videoId: "vidA09opqrs",
    song: "Echo Atlas",
    artist: "Farouk Stein",
    album: "Compass Rose",
    format: "ttml",
    syncType: "richsync",
    language: "en",
    score: 10.2,
    effectiveScore: 11.0,
    voteCount: 13,
    confidence: "high",
    hidden: false,
    submitterIdx: 0,
    userVote: null,
    lyricsLines: [
      "Verse line one a routed map",
      "Verse line two a folded scrap",
      "Chorus line one echo atlas",
      "Chorus line two won't pass us",
    ],
  },
  {
    id: 1016,
    videoId: "vidA10tuvwx",
    song: "Lantern Year",
    artist: "Dorian Quill",
    format: "lrc",
    syncType: "linesync",
    language: "en",
    score: 6.7,
    effectiveScore: 7.1,
    voteCount: 9,
    confidence: "medium",
    hidden: false,
    submitterIdx: 1,
    userVote: -1,
    lyricsLines: [
      "Verse line one a lantern lit",
      "Verse line two a quiet bit",
      "Chorus line one lantern year",
      "Chorus line two drawing near",
    ],
  },
]

function buildTtml(lines: string[]): string {
  const head =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="en">\n' +
    "  <body>\n    <div>\n"
  const body = lines
    .map((line, i) => {
      const begin = formatTtmlTime(i * 4)
      const end = formatTtmlTime((i + 1) * 4)
      return `      <p begin="${begin}" end="${end}">${escapeXml(line)}</p>`
    })
    .join("\n")
  const tail = "\n    </div>\n  </body>\n</tt>"
  return head + body + tail
}

function formatTtmlTime(seconds: number): string {
  const mm = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")
  const ss = (seconds % 60).toString().padStart(2, "0")
  return `00:${mm}:${ss}.000`
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function buildLrc(lines: string[]): string {
  return lines
    .map((line, i) => {
      const totalSeconds = i * 4
      const mm = Math.floor(totalSeconds / 60)
        .toString()
        .padStart(2, "0")
      const ss = (totalSeconds % 60).toString().padStart(2, "0")
      return `[${mm}:${ss}.00]${line}`
    })
    .join("\n")
}

function buildPlain(lines: string[]): string {
  return lines.join("\n")
}

function buildLyrics(template: VariantTemplate): string {
  if (template.format === "ttml") return buildTtml(template.lyricsLines)
  if (template.format === "lrc") return buildLrc(template.lyricsLines)
  return buildPlain(template.lyricsLines)
}

function deriveDuration(template: VariantTemplate): number {
  return template.lyricsLines.length * 4 + 12
}

function buildVariant(template: VariantTemplate): VariantFull {
  return {
    id: template.id,
    videoId: template.videoId,
    song: template.song,
    artist: template.artist,
    album: template.album,
    isrc: template.isrc,
    format: template.format,
    language: template.language,
    syncType: template.syncType,
    score: template.score,
    effectiveScore: template.effectiveScore,
    voteCount: template.voteCount,
    confidence: template.confidence,
    hidden: template.hidden,
    submitter: template.submitterIdx !== undefined ? { ...SEEDED_SUBMITTERS[template.submitterIdx] } : undefined,
    userVote: template.userVote,
    lyrics: buildLyrics(template),
  }
}

const INITIAL_CORPUS: VariantFull[] = SEED_TEMPLATES.map(buildVariant)
const corpus: VariantFull[] = INITIAL_CORPUS.map((v) => ({ ...v }))

export const SEED_LYRICS_CORPUS: VariantFull[] = corpus

export function __resetSpaExpansionSeedState(): void {
  corpus.length = 0
  for (const v of INITIAL_CORPUS) corpus.push({ ...v })
}

const QUEUE_PAGE_SIZE = 12

function buildQueueEntries(): QueueEntry[] {
  const titles = [
    { song: "Late Bus", artist: "Riverbend" },
    { song: "Soft Borders", artist: "Marrow & Knox" },
    { song: "Sunset Diagonal", artist: "Halcyon Bren" },
    { song: "Driveway Blues", artist: "Aurora Wynter" },
    { song: "Window Seat", artist: "Cassia Vale" },
    { song: "Off-Brand Dawn", artist: "Indigo Falls" },
    { song: "Tin Roof Holiday", artist: "Stein & Quill" },
    { song: "Cardboard Compass", artist: "The Constellations" },
    { song: "Storm Window", artist: "Farouk Stein" },
    { song: "Held Breath", artist: "Dorian Quill" },
    { song: "Hand-Me-Down Map", artist: "Greta Knox" },
    { song: "Telegram Sky", artist: "Elin Marrow" },
    { song: "Foothill Echo", artist: "Bren Halcyon" },
    { song: "Pocket Radio", artist: "Riverbend" },
    { song: "Backroad Hum", artist: "Marrow & Knox" },
    { song: "Streetlight Diary", artist: "Halcyon Bren" },
    { song: "Postcard Static", artist: "Aurora Wynter" },
    { song: "Hourglass Drift", artist: "Cassia Vale" },
    { song: "Spare Key", artist: "Indigo Falls" },
    { song: "Quiet Antenna", artist: "Stein & Quill" },
    { song: "Folded Atlas", artist: "The Constellations" },
    { song: "Ferry Whistle", artist: "Farouk Stein" },
    { song: "Loose Thread", artist: "Dorian Quill" },
    { song: "Paper Lantern", artist: "Greta Knox" },
    { song: "Driftwood Letter", artist: "Elin Marrow" },
    { song: "Static Garden", artist: "Bren Halcyon" },
    { song: "Lifted Awning", artist: "Riverbend" },
    { song: "Foglight Sonata", artist: "Marrow & Knox" },
    { song: "Patient Dial", artist: "Halcyon Bren" },
    { song: "Window Box", artist: "Aurora Wynter" },
    { song: "Spare Verse", artist: "Cassia Vale" },
    { song: "Backseat Lullaby", artist: "Indigo Falls" },
  ]
  return titles.map((t, i) => ({
    rank: i + 1,
    videoId: `vidQ${(i + 1).toString().padStart(2, "0")}xyz9`,
    song: t.song,
    artist: t.artist,
    thumbnailUrl: null,
    demand: 480 - i * 11,
    requestCount: Math.max(1, 20 - Math.floor(i / 2)),
  }))
}

export const SEED_QUEUE_ENTRIES: QueueEntry[] = buildQueueEntries()

const delay = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms))

function cloneVariantSummary(v: VariantFull): VariantSummary {
  const { lyrics: _lyrics, ...summary } = v
  return { ...summary }
}

function toSearchHit(v: VariantFull, matchScore?: number): LyricsSearchHit {
  const hit: LyricsSearchHit = {
    id: v.id,
    videoId: v.videoId,
    song: v.song,
    artist: v.artist,
    album: v.album,
    isrc: v.isrc,
    duration: deriveDurationFromLyrics(v),
    format: v.format,
    language: v.language,
    syncType: v.syncType,
    score: v.score,
    effectiveScore: v.effectiveScore,
    voteCount: v.voteCount,
    confidence: v.confidence,
  }
  if (matchScore !== undefined) hit.matchScore = matchScore
  return hit
}

function deriveDurationFromLyrics(v: VariantFull): number {
  const template = SEED_TEMPLATES.find((t) => t.id === v.id)
  return template ? deriveDuration(template) : 180
}

function topVariantPerVideo(): VariantFull[] {
  const grouped = new Map<string, VariantFull>()
  for (const v of corpus) {
    if (v.hidden) continue
    const current = grouped.get(v.videoId)
    if (!current || v.effectiveScore > current.effectiveScore) grouped.set(v.videoId, v)
  }
  return [...grouped.values()]
}

interface SeedSearchParams {
  q?: string
  song?: string
  artist?: string
}

export async function seedSearch(params: SeedSearchParams): Promise<{ results: LyricsSearchHit[] }> {
  await delay(150)
  if (params.q?.toLowerCase() === "midnight") return { results: buildMidnightResults() }
  if (params.q && params.q.length > 0) return { results: substringSearch(params.q) }
  const composite = [params.song, params.artist].filter(Boolean).join(" ").trim()
  if (composite.length === 0) return { results: [] }
  return { results: substringSearch(composite) }
}

function buildMidnightResults(): LyricsSearchHit[] {
  const tops = topVariantPerVideo()
  const byVideoId = new Map(tops.map((v) => [v.videoId, v]))
  const order: LyricsSearchHit[] = []
  const tier1Ids = ["vidA01abcde", "vidA06zabcd"]
  for (const id of tier1Ids) {
    const v = byVideoId.get(id)
    if (v) order.push(toSearchHit(v))
  }
  const tier2Ids = ["vidA05uvwxy"]
  for (const id of tier2Ids) {
    const v = byVideoId.get(id)
    if (v) order.push(toSearchHit(v))
  }
  const tier3Candidates = ["vidA02fghij", "vidA09opqrs", "vidA04pqrst"]
  const tier3Scores = [0.86, 0.74, 0.62]
  tier3Candidates.forEach((id, i) => {
    const v = byVideoId.get(id)
    if (v) order.push(toSearchHit(v, tier3Scores[i]))
  })
  return order
}

function substringSearch(q: string): LyricsSearchHit[] {
  const needle = q.toLowerCase()
  const tops = topVariantPerVideo()
  const matches = tops.filter((v) => {
    if (v.song.toLowerCase().includes(needle)) return true
    if (v.artist.toLowerCase().includes(needle)) return true
    if (v.album?.toLowerCase().includes(needle)) return true
    return false
  })
  return matches.slice(0, 5).map((v) => toSearchHit(v))
}

export async function seedLyricsVariants(videoId: string): Promise<{ variants: VariantSummary[] }> {
  await delay(150)
  const matches = corpus.filter((v) => v.videoId === videoId)
  matches.sort((a, b) => b.effectiveScore - a.effectiveScore)
  return { variants: matches.map(cloneVariantSummary) }
}

export async function seedLyricsVariant(id: number): Promise<{ variant: VariantFull }> {
  await delay(150)
  const found = corpus.find((v) => v.id === id)
  if (!found) throw new Error(`HTTP 404 for /lyrics/${id}`)
  return { variant: { ...found } }
}

export async function seedQueue(opts: { cursor?: string }): Promise<{
  items: QueueEntry[]
  nextCursor: string | null
}> {
  await delay(150)
  const page = parseCursor(opts.cursor)
  const start = page * QUEUE_PAGE_SIZE
  const slice = SEED_QUEUE_ENTRIES.slice(start, start + QUEUE_PAGE_SIZE)
  const nextStart = start + QUEUE_PAGE_SIZE
  const nextCursor = nextStart < SEED_QUEUE_ENTRIES.length ? `page-${page + 1}` : null
  return { items: slice.map((entry) => ({ ...entry })), nextCursor }
}

function parseCursor(cursor?: string): number {
  if (!cursor || cursor.length === 0) return 0
  const match = cursor.match(/^page-(\d+)$/)
  if (!match) return 0
  return Number.parseInt(match[1], 10)
}

export async function seedSongs(): Promise<SongsLeaderboardResponse> {
  await delay(100)
  const mostWanted: SongLeaderboardEntry[] = SEED_QUEUE_ENTRIES.slice(0, 5).map((entry, i) => ({
    ...entry,
    rank: i + 1,
    section: "most_wanted" as const,
  }))
  const needsFixingSource = topVariantPerVideo()
    .filter((v) => v.confidence !== "high")
    .slice(0, 4)
  const needsFixing: SongLeaderboardEntry[] = needsFixingSource.map((v, i) => ({
    rank: i + 1,
    videoId: v.videoId,
    song: v.song,
    artist: v.artist,
    thumbnailUrl: null,
    demand: 90 - i * 7,
    requestCount: Math.max(1, 12 - i * 2),
    section: "needs_fixing" as const,
  }))
  return { mostWanted, needsFixing }
}

export async function seedVote(id: number, value: 1 | -1): Promise<void> {
  await delay(200)
  const target = corpus.find((v) => v.id === id)
  if (!target) throw new Error(`HTTP 404 for /lyrics/${id}/vote`)
  const prev = target.userVote ?? null
  if (prev === value) return
  if (prev === null) {
    target.voteCount += 1
    target.score += value
  } else {
    target.score += 2 * value
  }
  target.userVote = value
}

export async function seedUnvote(id: number): Promise<void> {
  await delay(200)
  const target = corpus.find((v) => v.id === id)
  if (!target) throw new Error(`HTTP 404 for /lyrics/${id}/vote`)
  const prev = target.userVote ?? null
  if (prev === null) return
  target.voteCount -= 1
  target.score -= prev
  target.userVote = null
}

export async function seedReport(
  id: number,
  _reason: "wrong_song" | "bad_sync" | "offensive" | "spam" | "other",
  _details?: string,
): Promise<void> {
  await delay(200)
  const target = corpus.find((v) => v.id === id)
  if (!target) throw new Error(`HTTP 404 for /lyrics/${id}/report`)
}
