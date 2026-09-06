import type {
  BadgeCatalogue,
  BadgeDef,
  BadgeImage,
  BadgeTier,
  CuratorLeaderboardEntry,
  CuratorsLeaderboardResponse,
  SongsLeaderboardResponse,
  UserGamification,
  UserRankResponse,
  UserSubmission,
  UserSubmissionsResponse,
} from "./types"

const SEEDED_NOW = Math.floor(Date.now() / 1000)

export const SEED_CURATORS: CuratorLeaderboardEntry[] = [
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
      lastVoteAt: null,
      discordLinked: false,
    }
  }
  return {
    ranked: true,
    keyId: entry.keyId,
    displayName: entry.displayName,
    reputation: entry.reputation,
    score: entry.score,
    submissionCount: entry.submissionCount,
    totalUpvotes: entry.totalUpvotes,
    rank: entry.rank,
    lastVoteAt: SEEDED_NOW - 3600,
    discordLinked: true,
  }
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

export async function seedUserSubmissions(_keyId: string): Promise<UserSubmissionsResponse> {
  await delay()
  return { submissions: SEED_SUBMISSIONS }
}

// Dev seed points at the flat art served by the devBadgeArt vite plugin (see vite.config.ts).
// Production uses the API's /badges/:key/image.svg endpoint instead.
function badgeImage(key: string): BadgeImage {
  return {
    color: `/badge-art/${key}.svg`,
    mono: `/badge-art/${key}_mono.svg`,
  }
}

function badgeTiers(key: string, thresholds: number[]): BadgeTier[] {
  return thresholds.map((threshold, i) => ({
    level: i + 1,
    threshold,
    image: {
      color: `/badge-art/${key}_${i + 1}.svg`,
      mono: `/badge-art/${key}_mono.svg`,
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
    image: badgeImage("committee"),
  },
  {
    key: "community",
    name: "Community",
    description: "The shared community lyrics account.",
    category: "special",
    kind: "special",
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

export async function seedUserBadges(keyId: string): Promise<UserGamification> {
  await delay()
  return {
    keyId,
    level: 8,
    xp: 3200,
    xpForNext: 4000,
    tier: "legendary",
    tierRank: 1,
    featured: ["most-loved", "legendary", "verified-contributor", "sharp-ear", "trailblazer"],
    counts: { earned: 6, total: SEED_CATALOGUE.badges.length },
    topExpertise: [
      { scope: "artist", name: "Radiohead", rank: 2 },
      { scope: "language", name: "Japanese", rank: 5 },
    ],
    badges: [
      { key: "verified-contributor", earned: true, tier: 3, earnedAt: SEEDED_NOW - 30 * 86400, featured: true },
      { key: "sharp-ear", earned: true, tier: 2, earnedAt: SEEDED_NOW - 20 * 86400, featured: true },
      { key: "trailblazer", earned: true, tier: 2, earnedAt: SEEDED_NOW - 14 * 86400, featured: true },
      { key: "most-loved", earned: true, earnedAt: SEEDED_NOW - 10 * 86400, featured: true },
      { key: "first-submission", earned: true, earnedAt: SEEDED_NOW - 60 * 86400, featured: false },
      { key: "legendary", earned: true, earnedAt: SEEDED_NOW - 2 * 86400, featured: true },
      { key: "polyglot", earned: false, tier: 1, progress: { current: 2, next: 3 }, featured: false },
      { key: "first-responder", earned: false, progress: { current: 0, next: 1 }, featured: false },
    ],
  }
}
