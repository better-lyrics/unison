export const config = {
	submission: {
		maxVariantsPerUserPerVideo: 3,
	},

	moderation: {
		reportsThreshold: 5,
	},

	reputation: {
		default: 1.0,
		min: 0.0,
		max: 2.0,
		consensusDelta: 0.1,
		selfVoteWeight: 0.5,
		minVotesForConfidence: 5,
	},

	ranking: {
		recencyWeight: 0.5, // bonus for new entries, decays as 1/(1 + age_days)
		confidenceBase: 2, // +N in ln(vote_count + N), keeps ln always positive
		syncTypeBoost: {
			richsync: 1.3,
			linesync: 1.0,
			plain: 0.7,
		},
	},

	search: {
		defaultLimit: 20,
		maxLimit: 50,
		minQueryLength: 2,
		similarityThreshold: 0.15,
	},

	feed: {
		defaultLimit: 20,
		maxLimit: 50,
		maxArtists: 20,
		globalCacheTtl: 300, // 5 min Redis cache for global feed
	},

	cache: {
		ttlSeconds: 604800, // 1 week
	},

	http: {
		maxBodyBytes: 8 * 1024 * 1024,
	},

	rateLimit: {
		read: {
			maxRequests: 120,
			windowSeconds: 60,
		},
		write: {
			maxRequests: 10,
			windowSeconds: 60,
		},
	},

	matching: {
		durationTolerance: 2, // ±2 seconds for duration matching
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
			min: 1,
			max: 60 * 60, // 1 hour in seconds
		},
		report: {
			maxDetailsLength: 1000,
		},
	},
} as const

export type Config = typeof config
