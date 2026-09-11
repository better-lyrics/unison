import { toHandle } from "./handle"
import type {
  BadgeCatalogue,
  BadgeDef,
  BadgeImage,
  BadgeTier,
  CuratorLeaderboardEntry,
  CuratorsLeaderboardResponse,
  ExpertiseEntry,
  LeaderboardBadge,
  SongsLeaderboardResponse,
  TierName,
  UserBadge,
  UserGamification,
  UserRankResponse,
  UserSubmission,
  UserSubmissionsResponse,
} from "./types"

const SEEDED_NOW = Math.floor(Date.now() / 1000)

const DEFAULT_CURATORS: CuratorLeaderboardEntry[] = [
  {
    keyId: "a".repeat(64),
    displayName: "Aurora Wynter",
    reputation: 1.9,
    score: 312.4,
    submissionCount: 87,
    totalUpvotes: 540,
    rank: 1,
    discordLinked: true,
  },
  {
    keyId: "b".repeat(64),
    displayName: "Bren Halcyon",
    reputation: 1.7,
    score: 248.0,
    submissionCount: 65,
    totalUpvotes: 410,
    rank: 2,
    discordLinked: false,
  },
  {
    keyId: "c".repeat(64),
    displayName: "Cassia Vale",
    reputation: 1.5,
    score: 187.6,
    submissionCount: 52,
    totalUpvotes: 312,
    rank: 3,
    discordLinked: true,
  },
  {
    keyId: "d".repeat(64),
    displayName: "Dorian Quill",
    reputation: 1.2,
    score: 142.3,
    submissionCount: 41,
    totalUpvotes: 220,
    rank: 4,
    discordLinked: false,
  },
  {
    keyId: "e".repeat(64),
    displayName: "Elin Marrow",
    reputation: 1.1,
    score: 98.7,
    submissionCount: 33,
    totalUpvotes: 180,
    rank: 5,
    discordLinked: false,
  },
  {
    keyId: "f".repeat(64),
    displayName: "Farouk Stein",
    reputation: 1.0,
    score: 54.2,
    submissionCount: 21,
    totalUpvotes: 95,
    rank: 12,
    discordLinked: true,
  },
  {
    keyId: "g".repeat(64),
    displayName: "Greta Knox",
    reputation: 0.9,
    score: 18.4,
    submissionCount: 9,
    totalUpvotes: 32,
    rank: 137,
    discordLinked: false,
  },
]

interface RealSeed {
  REAL_CURATORS: CuratorLeaderboardEntry[]
  REAL_SUBMISSIONS: Record<string, UserSubmission[]>
}

// Optional local real-data override (web/src/lib/dev-seed.real.ts, gitignored) built from a
// prod dump. Absent in committed builds, so this falls back to the synthetic curators.
const realSeed = Object.values(import.meta.glob<RealSeed>("./dev-seed.real.ts", { eager: true }))[0] as
  | RealSeed
  | undefined

const COMMUNITY_KEY_ID = "cea10b57de8e060ed1a180a00c2bc717a2ab4f231d88fd33ffa6a50a04f23b6e"

const RAW_CURATORS: CuratorLeaderboardEntry[] = realSeed?.REAL_CURATORS ?? DEFAULT_CURATORS

// Synthetic tier and top-badge values so the leaderboard preview shows gems and
// badges. Real backend data carries these fields directly.
const tierForSeedRank = (rank: number): string =>
  rank === 1 ? "legendary" : rank === 2 ? "grandmaster" : rank === 3 ? "master" : rank <= 8 ? "elite" : "lyricist"

const SAMPLE_TOP_BADGES: LeaderboardBadge[] = [
  { key: "most-loved", name: "Most Loved" },
  { key: "karaoke-master", name: "Karaoke Master", tier: 3 },
  { key: "trailblazer", name: "Trailblazer", tier: 2 },
  { key: "prolific", name: "Prolific", tier: 2 },
  { key: "fan-favorite", name: "Fan Favorite" },
]

const SAMPLE_FEATURED: LeaderboardBadge[] = [
  { key: "legendary", name: "Legendary" },
  { key: "karaoke-master", name: "Karaoke Master", tier: 3 },
  { key: "prolific", name: "Prolific", tier: 2 },
  { key: "tastemaker", name: "Tastemaker", tier: 1 },
  { key: "most-loved", name: "Most Loved" },
]

// The community account is shown by score but sits outside the ranks: it holds no rank,
// and real curators keep contiguous ranks 1..N (mirrors getCuratorLeaderboard).
export const SEED_CURATORS: CuratorLeaderboardEntry[] = (() => {
  let ranked = 0
  return RAW_CURATORS.map((c) => {
    if (c.keyId === COMMUNITY_KEY_ID) {
      return {
        ...c,
        rank: 0,
        community: true,
        tier: null,
        topBadge: { key: "community", name: "Community account" },
        featured: [{ key: "community", name: "Community account" }],
        badgeCount: 1,
      }
    }
    const rank = ++ranked
    return {
      ...c,
      rank,
      community: false,
      tier: tierForSeedRank(rank),
      topBadge: SAMPLE_TOP_BADGES[rank % SAMPLE_TOP_BADGES.length],
      featured: SAMPLE_FEATURED.slice(0, (rank % 4) + 2),
      badgeCount: (rank % 5) + 2,
    }
  })
})()

const delay = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms))

export async function seedCurators(): Promise<CuratorsLeaderboardResponse> {
  await delay()
  return { curators: SEED_CURATORS }
}

export async function seedSongs(): Promise<SongsLeaderboardResponse> {
  await delay()
  return { mostWanted: [], needsFixing: [] }
}

export async function seedUserRank(keyId: string): Promise<UserRankResponse> {
  await delay()
  const entry = SEED_CURATORS.find((c) => c.keyId === keyId)
  if (!entry) {
    return {
      ranked: false,
      keyId,
      displayName: "Unknown Curator",
      handle: null,
      lastVoteAt: null,
      discordLinked: false,
    }
  }
  return {
    ranked: true,
    keyId: entry.keyId,
    displayName: entry.displayName,
    handle: toHandle(entry.displayName),
    community: entry.community ?? false,
    reputation: entry.reputation,
    score: entry.score,
    submissionCount: entry.submissionCount,
    totalUpvotes: entry.totalUpvotes,
    rank: entry.rank,
    lastVoteAt: SEEDED_NOW - 3600,
    discordLinked: true,
  }
}

export async function seedUserByHandle(handle: string): Promise<{ keyId: string }> {
  await delay()
  const wanted = handle.toLowerCase()
  const match = SEED_CURATORS.find((c) => toHandle(c.displayName) === wanted)
  if (!match) throw new Error(`HTTP 404 for /users/by-handle/${handle}`)
  return { keyId: match.keyId }
}

const SEED_SUBMISSIONS: UserSubmission[] = [
  {
    id: 1,
    videoId: "dQw4w9WgXcQ",
    song: "Never Gonna Give You Up",
    artist: "Rick Astley",
    album: "Whenever You Need Somebody",
    duration: 213,
    format: "ttml",
    syncType: "richsync",
    language: "en",
    effectiveScore: 48.2,
    voteCount: 51,
    confidence: "high",
    createdAt: SEEDED_NOW - 3600,
    hidden: false,
  },
  {
    id: 2,
    videoId: "60ItHLz5WEA",
    song: "Faded",
    artist: "Alan Walker",
    duration: 212,
    format: "lrc",
    syncType: "linesync",
    language: "en",
    effectiveScore: 31.0,
    voteCount: 34,
    confidence: "high",
    createdAt: SEEDED_NOW - 2 * 86400,
    hidden: false,
  },
  {
    id: 3,
    videoId: "kJQP7kiw5Fk",
    song: "Despacito",
    artist: "Luis Fonsi",
    duration: 281,
    format: "lrc",
    syncType: "linesync",
    language: "es",
    effectiveScore: 22.5,
    voteCount: 28,
    confidence: "medium",
    createdAt: SEEDED_NOW - 5 * 86400,
    hidden: false,
  },
  {
    id: 4,
    videoId: "JGwWNGJdvx8",
    song: "Shape of You",
    artist: "Ed Sheeran",
    duration: 234,
    format: "plain",
    syncType: "plain",
    language: "en",
    effectiveScore: 9.1,
    voteCount: 12,
    confidence: "low",
    createdAt: SEEDED_NOW - 12 * 86400,
    hidden: false,
  },
  {
    id: 5,
    videoId: "RgKAFK5djSk",
    song: "See You Again",
    artist: "Wiz Khalifa",
    duration: 229,
    format: "ttml",
    syncType: "richsync",
    language: "en",
    effectiveScore: 14.7,
    voteCount: 19,
    confidence: "medium",
    createdAt: SEEDED_NOW - 20 * 86400,
    hidden: true,
  },
  {
    id: 6,
    videoId: "fJ9rUzIMcZQ",
    song: "Bohemian Rhapsody",
    artist: "Queen",
    album: "A Night at the Opera",
    duration: 354,
    format: "lrc",
    syncType: "linesync",
    language: "en",
    effectiveScore: 40.3,
    voteCount: 44,
    confidence: "high",
    createdAt: SEEDED_NOW - 30 * 86400,
    hidden: false,
  },
]

export async function seedUserSubmissions(keyId: string): Promise<UserSubmissionsResponse> {
  await delay()
  const real = realSeed?.REAL_SUBMISSIONS?.[keyId]
  return { submissions: real ?? SEED_SUBMISSIONS }
}

// Dev seed points at the flat art served by the devBadgeArt vite plugin (see vite.config.ts).
// Production uses the API's /badges/:key/image.svg endpoint instead.
function badgeImage(key: string): BadgeImage {
  return {
    color: `/badge-art/${key}.svg`,
    mono: `/badge-art/${key}_mono.svg`,
    silhouette: `/badge-art/${key}_silhouette.svg`,
  }
}

function badgeTiers(key: string, thresholds: number[]): BadgeTier[] {
  return thresholds.map((threshold, i) => ({
    level: i + 1,
    threshold,
    image: {
      color: `/badge-art/${key}_${i + 1}.svg`,
      mono: `/badge-art/${key}_mono.svg`,
      silhouette: `/badge-art/${key}_silhouette.svg`,
    },
  }))
}

const SEED_BADGES: BadgeDef[] = [
  {
    key: "verified-contributor",
    name: "Verified Contributor",
    description: "Submitted lyrics that reached medium or higher confidence.",
    category: "output",
    kind: "medal",
    tiers: badgeTiers("verified-contributor", [1, 3, 10]),
    image: badgeImage("verified-contributor"),
  },
  {
    key: "sharp-ear",
    name: "Sharp Ear",
    description: "Cast votes that matched the community consensus.",
    category: "curation",
    kind: "medal",
    tiers: badgeTiers("sharp-ear", [10, 25, 50]),
    image: badgeImage("sharp-ear"),
  },
  {
    key: "trailblazer",
    name: "Trailblazer",
    description: "First to add lyrics for a song.",
    category: "coverage",
    kind: "medal",
    tiers: badgeTiers("trailblazer", [5, 25, 100]),
    rarity: 0.08,
    image: badgeImage("trailblazer"),
  },
  {
    key: "first-responder",
    name: "First Responder",
    description: "First to fill a requested song.",
    category: "coverage",
    kind: "medal",
    tiers: badgeTiers("first-responder", [1, 3, 5]),
    image: badgeImage("first-responder"),
  },
  {
    key: "polyglot",
    name: "Polyglot",
    description: "Contributed lyrics across several languages.",
    category: "coverage",
    kind: "medal",
    tiers: badgeTiers("polyglot", [3, 5, 10]),
    rarity: 0.05,
    image: badgeImage("polyglot"),
  },
  {
    key: "most-loved",
    name: "Most Loved",
    description: "A lyric you submitted earned a high score with strong community support.",
    category: "acclaim",
    kind: "medal",
    rarity: 0.03,
    image: badgeImage("most-loved"),
  },
  {
    key: "prolific",
    name: "Prolific",
    description: "Submitted a large number of accepted lyrics.",
    category: "output",
    kind: "medal",
    tiers: badgeTiers("prolific", [25, 75, 150]),
    image: badgeImage("prolific"),
  },
  {
    key: "firefighter",
    name: "Firefighter",
    description: "Filled songs that many people were waiting for.",
    category: "coverage",
    kind: "medal",
    tiers: badgeTiers("firefighter", [3, 10, 25]),
    image: badgeImage("firefighter"),
  },
  {
    key: "karaoke-master",
    name: "Karaoke Master",
    description: "Submitted verified word by word synced lyrics.",
    category: "craft",
    kind: "medal",
    tiers: badgeTiers("karaoke-master", [5, 15, 40]),
    image: badgeImage("karaoke-master"),
  },
  {
    key: "line-dancer",
    name: "Line Dancer",
    description: "Submitted verified line synced lyrics.",
    category: "craft",
    kind: "medal",
    tiers: badgeTiers("line-dancer", [5, 15, 40]),
    image: badgeImage("line-dancer"),
  },
  {
    key: "rarity-hunter",
    name: "Rarity Hunter",
    description: "Contributed lyrics in rarely covered languages.",
    category: "coverage",
    kind: "medal",
    tiers: badgeTiers("rarity-hunter", [3, 6, 10]),
    rarity: 0.04,
    image: badgeImage("rarity-hunter"),
  },
  {
    key: "tastemaker",
    name: "Tastemaker",
    description: "Upvoted winning lyrics early, before the crowd.",
    category: "curation",
    kind: "medal",
    tiers: badgeTiers("tastemaker", [5, 15]),
    image: badgeImage("tastemaker"),
  },
  {
    key: "guardian",
    name: "Guardian",
    description: "Filed reports that led to bad lyrics being removed.",
    category: "curation",
    kind: "medal",
    tiers: badgeTiers("guardian", [3, 10]),
    image: badgeImage("guardian"),
  },
  {
    key: "fan-favorite",
    name: "Fan Favorite",
    description: "A lyric you submitted earned a wave of upvotes.",
    category: "acclaim",
    kind: "medal",
    image: badgeImage("fan-favorite"),
  },
  {
    key: "flawless",
    name: "Flawless",
    description: "A lyric you submitted earned only upvotes.",
    category: "craft",
    kind: "medal",
    image: badgeImage("flawless"),
  },
  {
    key: "perfectionist",
    name: "Perfectionist",
    description: "A lyric you submitted earned a top score with broad rater agreement.",
    category: "craft",
    kind: "medal",
    image: badgeImage("perfectionist"),
  },
  {
    key: "early-adopter",
    name: "Early Adopter",
    description: "Joined Better Lyrics in the early days.",
    category: "special",
    kind: "medal",
    secret: true,
    image: badgeImage("early-adopter"),
  },
  {
    key: "first-submission",
    name: "First Submission",
    description: "Submitted your first lyric.",
    category: "special",
    kind: "special",
    image: badgeImage("first-submission"),
  },
  {
    key: "committee",
    name: "Better Lyrics Council",
    description: "A member of the Better Lyrics Council.",
    category: "special",
    kind: "special",
    secret: true,
    image: badgeImage("committee"),
  },
  {
    key: "community",
    name: "Community",
    description: "The shared community lyrics account.",
    category: "special",
    kind: "special",
    secret: true,
    image: badgeImage("community"),
  },
]

const SEED_TIER_BADGES: BadgeDef[] = [
  {
    key: "lyricist",
    name: "Lyricist",
    description: "Ranked in the top 20% of curators.",
    category: "tier",
    kind: "title",
    image: badgeImage("lyricist"),
  },
  {
    key: "elite",
    name: "Elite",
    description: "Ranked in the top 5% of curators.",
    category: "tier",
    kind: "title",
    image: badgeImage("elite"),
  },
  {
    key: "master",
    name: "Master",
    description: "The third ranked curator.",
    category: "tier",
    kind: "title",
    image: badgeImage("master"),
  },
  {
    key: "grandmaster",
    name: "Grandmaster",
    description: "The second ranked curator.",
    category: "tier",
    kind: "title",
    image: badgeImage("grandmaster"),
  },
  {
    key: "legendary",
    name: "Legendary",
    description: "The top ranked curator.",
    category: "tier",
    kind: "title",
    image: badgeImage("legendary"),
  },
]

const SEED_CATALOGUE: BadgeCatalogue = {
  badges: [...SEED_BADGES, ...SEED_TIER_BADGES],
  display: {
    inlineGlyphs: 1,
    featuredMax: 5,
    rarityThreshold: 0.1,
    categoryOrder: ["tier", "output", "craft", "coverage", "curation", "acclaim", "consistency", "special"],
  },
}

export async function seedBadgeCatalogue(): Promise<BadgeCatalogue> {
  await delay()
  return SEED_CATALOGUE
}

// Secret badges (community, committee) are not attainable by the public, so they never
// count toward the "of N" total unless earned. No seeded user earns them here.
const BADGE_TOTAL = SEED_CATALOGUE.badges.filter((b) => !b.secret).length
const DAY = 86400
const EXPERTISE_ARTISTS = ["Radiohead", "The Weeknd", "Tame Impala", "Daft Punk", "Björk", "Arca", "Fishmans"]
const EXPERTISE_LANGS = ["Japanese", "Korean", "Spanish", "French", "Portuguese", "German", "Icelandic"]

function tierForRank(rank: number): { tier: TierName; tierRank: number | null } {
  if (rank === 1) return { tier: "legendary", tierRank: 1 }
  if (rank === 2) return { tier: "grandmaster", tierRank: 2 }
  if (rank === 3) return { tier: "master", tierRank: 3 }
  if (rank <= 5) return { tier: "elite", tierRank: null }
  return { tier: "lyricist", tierRank: null }
}

function medalTier(count: number, thresholds: number[]): number | undefined {
  const reached = thresholds.filter((t) => t <= count).length
  return reached > 0 ? reached : undefined
}

// The showcased rank-1 profile, kept stable so /dev/me matches the finalised design reference.
function auroraShowcase(keyId: string): UserGamification {
  return {
    keyId,
    level: 8,
    xp: 3200,
    xpForNext: 4000,
    xpFloor: 2800,
    tier: "legendary",
    tierRank: 1,
    featured: ["karaoke-master", "prolific", "most-loved", "legendary", "verified-contributor"],
    counts: { earned: 13, total: BADGE_TOTAL },
    topExpertise: [
      { scope: "artist", name: "Radiohead", rank: 2 },
      { scope: "language", name: "Japanese", rank: 5 },
    ],
    badges: [
      { key: "verified-contributor", earned: true, tier: 3, earnedAt: SEEDED_NOW - 30 * DAY, featured: true },
      { key: "sharp-ear", earned: true, tier: 2, earnedAt: SEEDED_NOW - 20 * DAY, featured: false },
      { key: "trailblazer", earned: true, tier: 2, earnedAt: SEEDED_NOW - 14 * DAY, featured: false },
      { key: "most-loved", earned: true, earnedAt: SEEDED_NOW - 10 * DAY, featured: true },
      { key: "first-submission", earned: true, earnedAt: SEEDED_NOW - 60 * DAY, featured: false },
      { key: "legendary", earned: true, earnedAt: SEEDED_NOW - 2 * DAY, featured: true },
      { key: "prolific", earned: true, tier: 2, earnedAt: SEEDED_NOW - 22 * DAY, featured: true },
      { key: "karaoke-master", earned: true, tier: 3, earnedAt: SEEDED_NOW - 16 * DAY, featured: true },
      { key: "firefighter", earned: true, tier: 1, earnedAt: SEEDED_NOW - 9 * DAY, featured: false },
      { key: "tastemaker", earned: true, tier: 1, earnedAt: SEEDED_NOW - 6 * DAY, featured: false },
      { key: "fan-favorite", earned: true, earnedAt: SEEDED_NOW - 5 * DAY, featured: false },
      { key: "flawless", earned: true, earnedAt: SEEDED_NOW - 3 * DAY, featured: false },
      { key: "early-adopter", earned: true, earnedAt: SEEDED_NOW - 80 * DAY, featured: false },
      { key: "line-dancer", earned: false, tier: 1, progress: { current: 3, next: 5 }, featured: false },
      { key: "rarity-hunter", earned: false, tier: 1, progress: { current: 2, next: 3 }, featured: false },
      { key: "guardian", earned: false, tier: 1, progress: { current: 1, next: 3 }, featured: false },
      { key: "polyglot", earned: false, tier: 1, progress: { current: 2, next: 3 }, featured: false },
      { key: "first-responder", earned: false, progress: { current: 0, next: 1 }, featured: false },
      { key: "perfectionist", earned: false, featured: false },
    ],
  }
}

function derivedGamification(entry: CuratorLeaderboardEntry): UserGamification {
  const { tier, tierRank } = tierForRank(entry.rank)
  const level = Math.min(12, Math.max(1, Math.round(entry.score / 30) + 1))
  const xp = Math.round(entry.score * 12)
  const step = Math.max(60, 260 - Math.round(entry.score))
  const xpForNext = level >= 12 ? null : xp + step
  const xpFloor = Math.max(0, xp - step)

  const badges: UserBadge[] = [
    { key: "first-submission", earned: true, earnedAt: SEEDED_NOW - 55 * DAY, featured: false },
    { key: tier, earned: true, earnedAt: SEEDED_NOW - 4 * DAY, featured: true },
  ]

  const vc = medalTier(entry.submissionCount, [1, 3, 10])
  if (vc)
    badges.push({
      key: "verified-contributor",
      earned: true,
      tier: vc,
      earnedAt: SEEDED_NOW - 25 * DAY,
      featured: vc >= 2,
    })

  const se = medalTier(entry.totalUpvotes, [50, 200, 400])
  if (se) badges.push({ key: "sharp-ear", earned: true, tier: se, earnedAt: SEEDED_NOW - 18 * DAY, featured: se >= 3 })

  if (entry.rank <= 3) {
    badges.push({ key: "trailblazer", earned: true, tier: 2, earnedAt: SEEDED_NOW - 12 * DAY, featured: true })
  } else {
    badges.push({
      key: "trailblazer",
      earned: false,
      tier: 1,
      progress: { current: Math.max(1, 6 - entry.rank), next: 5 },
      featured: false,
    })
  }

  if (entry.score >= 120)
    badges.push({ key: "most-loved", earned: true, earnedAt: SEEDED_NOW - 8 * DAY, featured: true })

  badges.push({
    key: "polyglot",
    earned: false,
    tier: 1,
    // A locked badge must stay below its threshold, so cap progress at next - 1.
    progress: { current: (entry.rank % 2) + 1, next: 3 },
    featured: false,
  })
  badges.push({ key: "first-responder", earned: false, progress: { current: 0, next: 1 }, featured: false })

  const featured = badges
    .filter((b) => b.earned && b.featured)
    .map((b) => b.key)
    .slice(0, 5)
  const earned = badges.filter((b) => b.earned).length

  const topExpertise: ExpertiseEntry[] = [
    { scope: "artist", name: EXPERTISE_ARTISTS[entry.rank % EXPERTISE_ARTISTS.length], rank: entry.rank },
    { scope: "language", name: EXPERTISE_LANGS[entry.rank % EXPERTISE_LANGS.length], rank: (entry.rank % 7) + 1 },
  ]

  return {
    keyId: entry.keyId,
    level,
    xp,
    xpForNext,
    xpFloor,
    tier,
    tierRank,
    featured,
    counts: { earned, total: BADGE_TOTAL },
    topExpertise,
    badges,
  }
}

export async function seedUserBadges(keyId: string): Promise<UserGamification> {
  await delay()
  if (keyId === COMMUNITY_KEY_ID) {
    return {
      keyId,
      level: 1,
      xp: 0,
      xpForNext: 50,
      xpFloor: 0,
      tier: null,
      tierRank: null,
      featured: ["community"],
      counts: { earned: 1, total: 1 },
      badges: [{ key: "community", earned: true, earnedAt: SEEDED_NOW - 90 * DAY, featured: true }],
    }
  }
  const entry = SEED_CURATORS.find((c) => c.keyId === keyId)
  if (!entry) {
    return {
      keyId,
      level: 1,
      xp: 0,
      xpForNext: 50,
      xpFloor: 0,
      tier: null,
      tierRank: null,
      featured: [],
      counts: { earned: 0, total: BADGE_TOTAL },
      badges: [],
    }
  }
  return entry.rank === 1 ? auroraShowcase(keyId) : derivedGamification(entry)
}

// Mirrors the backend setFeatured contract for the dev preview: only earned badges may be
// featured, and the selection is capped at featuredMax.
export async function seedSetFeatured(keyId: string, featured: string[]): Promise<UserGamification> {
  await delay()
  const current = await seedUserBadges(keyId)
  const earnedKeys = new Set(current.badges.filter((b) => b.earned).map((b) => b.key))
  const next = featured.filter((k) => earnedKeys.has(k)).slice(0, SEED_CATALOGUE.display.featuredMax)
  const nextSet = new Set(next)
  return {
    ...current,
    featured: next,
    badges: current.badges.map((b) => ({ ...b, featured: b.earned && nextSet.has(b.key) })),
  }
}
