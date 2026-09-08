export const COMMUNITY_KEY_ID = "cea10b57de8e060ed1a180a00c2bc717a2ab4f231d88fd33ffa6a50a04f23b6e"

export const config = {
	submission: {
		maxVariantsPerUserPerVideo: 3,
	},

	moderation: {
		reportsThreshold: 2,
		autoHide: {
			minVotes: 3,
			downvoteRatio: 0.8,
			maxEffectiveScore: -0.5,
			decisiveMinVotes: 2,
			decisiveMinAgeDays: 3,
			reputationPenalty: 0.2,
		},
	},

	requests: {
		windowDays: 30,
		discordNeutralWeight: 1.0,
		needsFixingReportThreshold: 5,
		leaderboard: {
			cacheTtl: 300,
			topN: 200,
			rankScanLimit: 5000,
		},
	},

	linking: {
		stateTtlSeconds: 600, // OAuth round-trip window for the Discord link flow
		discordScope: "identify",
		blacklistedKeyIds: new Set<string>([COMMUNITY_KEY_ID]),
	},

	migration: {
		sessionTtlSeconds: 900, // time to open the new extension and finish the OAuth prove
		commitLockSeconds: 60,
	},

	reputation: {
		default: 1.0,
		min: 0.0,
		max: 2.0,
		consensusDelta: 0.1,
		selfVoteWeight: 0,
		minVotesForConfidence: 3,
		minScoreForConfidence: 0.5,
		voteWeightFloor: 0.5,
	},

	ranking: {
		recencyWeight: 0.5, // bonus for new entries, decays as 1/(1 + age_days)
		confidenceBase: 2, // +N in ln(vote_count + N), keeps ln always positive
		syncTypeBoost: {
			richsync: 1.3,
			linesync: 1.0,
			plain: 0.7,
		},
		primarySlot: {
			repFloor: 1.0,
			minVotes: 3,
		},
	},

	gamification: {
		xp: {
			weights: {
				reachedMedium: 20,
				reachedHigh: 20,
				consensusVote: 2,
				requestFilled: 15,
				firstForSong: 10,
				penalized: -30,
			},
			levelThresholds: [0, 50, 150, 350, 700, 1200, 1900, 2800, 4000],
		},
		tiers: {
			podium: ["legendary", "grandmaster", "master"] as const,
			elite: { topPercent: 5 },
			lyricist: { topPercent: 20 },
		},
		boost: {
			quotaBase: 2,
			quotaPerTier: 2,
			rankingBonus: 1.5,
		},
		featured: { maxSlots: 5 },
		display: {
			inlineGlyphs: 1,
			rarityThreshold: 0.1,
			categoryOrder: [
				"tier",
				"output",
				"craft",
				"coverage",
				"curation",
				"acclaim",
				"consistency",
				"special",
			],
		},
		seal: { label: "Better Lyrics Council Approved (BLCA)" },
	},

	exploration: {
		enabled: true,
		epsilon: { low: 0.3, medium: 0.1, high: 0.03 },
		coldMaxVotes: 5,
		minSubmitterReputation: 0.5,
		maxChallengers: 10,
	},

	thresholdAudit: {
		enabled: true,
		schedule: "0 9 * * *",
		driftTolerance: 0.1,
		targets: {
			minVotesForConfidence: { targetFraction: 0.25, floor: 2, ceil: 10 },
			primarySlotMinVotes: { targetFraction: 0.2, floor: 2, ceil: 10 },
			autoHideMinVotes: { targetFraction: 0.15, floor: 2, ceil: 10 },
			autoHideDecisiveMinVotes: { targetFraction: 0.5, floor: 2, ceil: 10 },
			reportsThreshold: { targetFraction: 0.15, floor: 2, ceil: 10 },
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

	auth: {
		session: {
			ttlSeconds: 30 * 24 * 60 * 60,
		},
		challenge: {
			ttlSeconds: 5 * 60,
		},
		nickname: {
			pattern: "^[A-Za-z0-9_]{3,20}$",
			reserved: new Set<string>([
				"admin",
				"administrator",
				"mod",
				"moderator",
				"support",
				"staff",
				"official",
				"system",
				"root",
				"superuser",
				"owner",
				"unison",
				"betterlyrics",
				"better_lyrics",
				"youtube",
				"ytmusic",
				"spotify",
				"lyrics",
				"anonymous",
				"anon",
				"user",
				"guest",
				"null",
				"undefined",
				"deleted",
				"banned",
				"bot",
				"api",
				"www",
				"app",
				"server",
				"boidu",
			]),
			check: { maxRequests: 30, windowSeconds: 60 },
			write: { maxRequests: 5, windowSeconds: 3600 },
		},
	},

	dump: {
		minBytes: 1 * 1024 * 1024,
		retentionDays: 7,
	},

	translation: {
		provider: "google-lyrics-translate",
		parserVersion: 1,
		positiveTtlSeconds: 5 * 365 * 24 * 60 * 60, // ~5 years; translations are effectively permanent
		negativeTtlSeconds: 30 * 24 * 60 * 60, // confirmed deterministic failure: suppress ~a month
		negativeThreshold: 3, // deterministic parse failures before a song is suppressed
		maxLines: 200,
		maxLineLength: 500,
		maxLangLength: 35,
		userAgent:
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
	},
} as const

export type Config = typeof config
