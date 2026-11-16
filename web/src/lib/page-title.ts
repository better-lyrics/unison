export const SITE_TITLE = "Unison"

export const PAGE_TITLES = {
  home: SITE_TITLE,
  leaderboard: `Leaderboard · ${SITE_TITLE}`,
  sealed: `Sealed lyrics · ${SITE_TITLE}`,
  docs: `Docs · ${SITE_TITLE}`,
  downloads: `Downloads · ${SITE_TITLE}`,
} as const

export const NOT_FOUND_TITLE = `Not found · ${SITE_TITLE}`

export const songTitle = (song: string, artist: string) => `${song} · ${artist}`

export const profileTitle = (displayName: string) => displayName

const SECTION_TITLES: Record<string, string> = {
  "": PAGE_TITLES.home,
  curators: PAGE_TITLES.leaderboard,
  sealed: PAGE_TITLES.sealed,
  docs: PAGE_TITLES.docs,
  downloads: PAGE_TITLES.downloads,
  queue: `Queue · ${SITE_TITLE}`,
  search: `Search · ${SITE_TITLE}`,
  about: `About · ${SITE_TITLE}`,
  showcase: `Showcase · ${SITE_TITLE}`,
  me: `Me · ${SITE_TITLE}`,
  council: `Council · ${SITE_TITLE}`,
  exam: `Exam · ${SITE_TITLE}`,
  link: `Link · ${SITE_TITLE}`,
  migrate: `Migrate · ${SITE_TITLE}`,
  dev: `Dev · ${SITE_TITLE}`,
}

const SELF_TITLED = new Set(["song", "curator", "u"])

export function titleForPath(pathname: string): string | null {
  const section = pathname.split("/")[1] ?? ""
  if (SELF_TITLED.has(section)) return null
  return SECTION_TITLES[section] ?? SITE_TITLE
}
