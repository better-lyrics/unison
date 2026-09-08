export type BadgeCategory =
	| "tier"
	| "output"
	| "craft"
	| "coverage"
	| "curation"
	| "acclaim"
	| "consistency"
	| "special"

export type BadgeKind = "title" | "medal" | "special"

export interface BadgeImage {
	color: string
	mono: string
}

export interface BadgeTier {
	level: number
	name?: string
	threshold: number
	image?: BadgeImage
}

export interface BadgeDef {
	key: string
	name: string
	description: string
	category: BadgeCategory
	kind: BadgeKind
	tiers?: BadgeTier[]
	secret?: boolean
	rarity?: number
	image: BadgeImage
}

function image(key: string): BadgeImage {
	return {
		color: `/badges/${key}/image.svg?variant=color`,
		mono: `/badges/${key}/image.svg?variant=mono`,
	}
}

function tiers(key: string, thresholds: number[]): BadgeTier[] {
	return thresholds.map((threshold, i) => ({
		level: i + 1,
		threshold,
		image: {
			color: `/badges/${key}/image.svg?variant=color&tier=${i + 1}`,
			mono: `/badges/${key}/image.svg?variant=mono`,
		},
	}))
}

export const BADGES: BadgeDef[] = [
	{
		key: "most-loved",
		name: "Most Loved",
		description: "A lyric you submitted earned a high score with strong community support.",
		category: "acclaim",
		kind: "medal",
		image: image("most-loved"),
	},
	{
		key: "sharp-ear",
		name: "Sharp Ear",
		description: "Cast votes that matched the community consensus.",
		category: "curation",
		kind: "medal",
		tiers: tiers("sharp-ear", [10, 25, 50]),
		image: image("sharp-ear"),
	},
	{
		key: "verified-contributor",
		name: "Verified Contributor",
		description: "Submitted lyrics that reached medium or higher confidence.",
		category: "output",
		kind: "medal",
		tiers: tiers("verified-contributor", [1, 3, 10]),
		image: image("verified-contributor"),
	},
	{
		key: "trailblazer",
		name: "Trailblazer",
		description: "First to add lyrics for a song.",
		category: "coverage",
		kind: "medal",
		tiers: tiers("trailblazer", [5, 25, 100]),
		image: image("trailblazer"),
	},
	{
		key: "first-responder",
		name: "First Responder",
		description: "First to fill a requested song.",
		category: "coverage",
		kind: "medal",
		tiers: tiers("first-responder", [1, 3, 5]),
		image: image("first-responder"),
	},
	{
		key: "polyglot",
		name: "Polyglot",
		description: "Contributed lyrics across several languages.",
		category: "coverage",
		kind: "medal",
		tiers: tiers("polyglot", [3, 5, 10]),
		image: image("polyglot"),
	},
	{
		key: "prolific",
		name: "Prolific",
		description: "Submitted a large number of accepted lyrics.",
		category: "output",
		kind: "medal",
		tiers: tiers("prolific", [25, 75, 150]),
		image: image("prolific"),
	},
	{
		key: "firefighter",
		name: "Firefighter",
		description: "Filled songs that many people were waiting for.",
		category: "coverage",
		kind: "medal",
		tiers: tiers("firefighter", [3, 10, 25]),
		image: image("firefighter"),
	},
	{
		key: "karaoke-master",
		name: "Karaoke Master",
		description: "Submitted verified word by word synced lyrics.",
		category: "craft",
		kind: "medal",
		tiers: tiers("karaoke-master", [5, 15, 40]),
		image: image("karaoke-master"),
	},
	{
		key: "line-dancer",
		name: "Line Dancer",
		description: "Submitted verified line synced lyrics.",
		category: "craft",
		kind: "medal",
		tiers: tiers("line-dancer", [5, 15, 40]),
		image: image("line-dancer"),
	},
	{
		key: "rarity-hunter",
		name: "Rarity Hunter",
		description: "Contributed lyrics in rarely covered languages.",
		category: "coverage",
		kind: "medal",
		tiers: tiers("rarity-hunter", [3, 6, 10]),
		image: image("rarity-hunter"),
	},
	{
		key: "tastemaker",
		name: "Tastemaker",
		description: "Upvoted winning lyrics early, before the crowd.",
		category: "curation",
		kind: "medal",
		tiers: tiers("tastemaker", [5, 15]),
		image: image("tastemaker"),
	},
	{
		key: "guardian",
		name: "Guardian",
		description: "Filed reports that led to bad lyrics being removed.",
		category: "curation",
		kind: "medal",
		tiers: tiers("guardian", [3, 10]),
		image: image("guardian"),
	},
	{
		key: "fan-favorite",
		name: "Fan Favorite",
		description: "A lyric you submitted earned a wave of upvotes.",
		category: "acclaim",
		kind: "medal",
		image: image("fan-favorite"),
	},
	{
		key: "flawless",
		name: "Flawless",
		description: "A lyric you submitted earned only upvotes.",
		category: "craft",
		kind: "medal",
		image: image("flawless"),
	},
	{
		key: "perfectionist",
		name: "Perfectionist",
		description: "A lyric you submitted earned a top score with broad rater agreement.",
		category: "craft",
		kind: "medal",
		image: image("perfectionist"),
	},
	{
		key: "early-adopter",
		name: "Early Adopter",
		description: "Joined Better Lyrics in the early days.",
		category: "special",
		kind: "medal",
		secret: true,
		image: image("early-adopter"),
	},
	{
		key: "committee",
		name: "Better Lyrics Council",
		description: "A member of the Better Lyrics Council.",
		category: "special",
		kind: "special",
		secret: true,
		image: image("committee"),
	},
	{
		key: "first-submission",
		name: "First Submission",
		description: "Submitted your first lyric.",
		category: "special",
		kind: "special",
		image: image("first-submission"),
	},
	{
		key: "community",
		name: "Community",
		description: "The shared community lyrics account.",
		category: "special",
		kind: "special",
		secret: true,
		image: image("community"),
	},
]

export const TIER_BADGES: BadgeDef[] = [
	{
		key: "lyricist",
		name: "Lyricist",
		description: "Ranked in the top 20% of curators.",
		category: "tier",
		kind: "title",
		image: image("lyricist"),
	},
	{
		key: "elite",
		name: "Elite",
		description: "Ranked in the top 5% of curators.",
		category: "tier",
		kind: "title",
		image: image("elite"),
	},
	{
		key: "master",
		name: "Master",
		description: "The third ranked curator.",
		category: "tier",
		kind: "title",
		image: image("master"),
	},
	{
		key: "grandmaster",
		name: "Grandmaster",
		description: "The second ranked curator.",
		category: "tier",
		kind: "title",
		image: image("grandmaster"),
	},
	{
		key: "legendary",
		name: "Legendary",
		description: "The top ranked curator.",
		category: "tier",
		kind: "title",
		image: image("legendary"),
	},
]

export const CATALOGUE: BadgeDef[] = [...BADGES, ...TIER_BADGES]
