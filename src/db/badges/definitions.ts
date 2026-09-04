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
	legacy?: boolean
	image: BadgeImage
}

function image(key: string): BadgeImage {
	return {
		color: `/badges/${key}/image.svg?variant=color`,
		mono: `/badges/${key}/image.svg?variant=mono`,
	}
}

function tiers(thresholds: number[]): BadgeTier[] {
	return thresholds.map((threshold, i) => ({ level: i + 1, threshold }))
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
		tiers: tiers([10, 25, 50]),
		image: image("sharp-ear"),
	},
	{
		key: "verified-contributor",
		name: "Verified Contributor",
		description: "Submitted lyrics that reached medium or higher confidence.",
		category: "output",
		kind: "medal",
		tiers: tiers([1, 3, 10]),
		image: image("verified-contributor"),
	},
	{
		key: "trailblazer",
		name: "Trailblazer",
		description: "First to add lyrics for a song.",
		category: "coverage",
		kind: "medal",
		tiers: tiers([5, 25, 100]),
		image: image("trailblazer"),
	},
	{
		key: "first-responder",
		name: "First Responder",
		description: "First to fill a requested song.",
		category: "coverage",
		kind: "medal",
		image: image("first-responder"),
	},
	{
		key: "polyglot",
		name: "Polyglot",
		description: "Contributed lyrics across several languages.",
		category: "coverage",
		kind: "medal",
		tiers: tiers([3, 5, 10]),
		image: image("polyglot"),
	},
	{
		key: "committee",
		name: "Better Lyrics Council",
		description: "A member of the Better Lyrics Council.",
		category: "special",
		kind: "special",
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
