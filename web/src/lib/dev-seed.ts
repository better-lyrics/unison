import type {
  CuratorLeaderboardEntry,
  CuratorsLeaderboardResponse,
  SongsLeaderboardResponse,
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
