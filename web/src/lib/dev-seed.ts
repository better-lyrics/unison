import type {
  CuratorLeaderboardEntry,
  CuratorsLeaderboardResponse,
  SongsLeaderboardResponse,
  UserRankResponse,
  UserSubmissionsResponse,
} from "./types"

const SEEDED_NOW = Math.floor(Date.now() / 1000)

const SEED_CURATORS: CuratorLeaderboardEntry[] = [
  {
    keyId: "a".repeat(64),
    displayName: "Aurora Wynter",
    reputation: 1.9,
    score: 312.4,
    submissionCount: 87,
    totalUpvotes: 540,
    rank: 1,
  },
  {
    keyId: "b".repeat(64),
    displayName: "Bren Halcyon",
    reputation: 1.7,
    score: 248.0,
    submissionCount: 65,
    totalUpvotes: 410,
    rank: 2,
  },
  {
    keyId: "c".repeat(64),
    displayName: "Cassia Vale",
    reputation: 1.5,
    score: 187.6,
    submissionCount: 52,
    totalUpvotes: 312,
    rank: 3,
  },
  {
    keyId: "d".repeat(64),
    displayName: "Dorian Quill",
    reputation: 1.2,
    score: 142.3,
    submissionCount: 41,
    totalUpvotes: 220,
    rank: 4,
  },
  {
    keyId: "e".repeat(64),
    displayName: "Elin Marrow",
    reputation: 1.1,
    score: 98.7,
    submissionCount: 33,
    totalUpvotes: 180,
    rank: 5,
  },
  {
    keyId: "f".repeat(64),
    displayName: "Farouk Stein",
    reputation: 1.0,
    score: 54.2,
    submissionCount: 21,
    totalUpvotes: 95,
    rank: 12,
  },
  {
    keyId: "g".repeat(64),
    displayName: "Greta Knox",
    reputation: 0.9,
    score: 18.4,
    submissionCount: 9,
    totalUpvotes: 32,
    rank: 137,
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
  }
}

export async function seedUserSubmissions(_keyId: string): Promise<UserSubmissionsResponse> {
  await delay()
  return { submissions: [] }
}
