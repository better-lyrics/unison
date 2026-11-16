export const SITE_TITLE = "Unison"

export const PAGE_TITLES = {
	home: SITE_TITLE,
	leaderboard: `Leaderboard · ${SITE_TITLE}`,
	sealed: `Sealed lyrics · ${SITE_TITLE}`,
	docs: `Docs · ${SITE_TITLE}`,
	downloads: `Downloads · ${SITE_TITLE}`,
} as const

export const songTitle = (song: string, artist: string) => `${song} · ${artist}`

export const profileTitle = (displayName: string) => displayName
