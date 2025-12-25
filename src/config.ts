export const config = {
  protection: {
    minScoreToProtect: 5,
  },

  moderation: {
    reportsBeforePenalty: 5,
    penaltyScoreDeduction: 10,
  },

  reputation: {
    default: 1.0,
    min: 0.0,
    max: 2.0,
    consensusDelta: 0.1,
    selfVoteWeight: 0.5,
    minVotesForConfidence: 5,
  },

  cache: {
    ttlSeconds: 604800, // 1 week
  },

  matching: {
    durationToleranceMs: 2000, // ±2 seconds for duration matching
  },

  validation: {
    ttml: {
      maxSizeBytes: 5 * 1024 * 1024,
      minSizeBytes: 50,
    },
    song: {
      maxLength: 500,
    },
    artist: {
      maxLength: 500,
    },
    album: {
      maxLength: 500,
    },
    duration: {
      minMs: 1 * 1000,
      maxMs: 60 * 60 * 1000,
    },
    report: {
      maxDetailsLength: 1000,
    },
  },
} as const;

export type Config = typeof config;
