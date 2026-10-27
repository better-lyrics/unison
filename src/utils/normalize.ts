/**
 * Normalize a string for search matching.
 * Lowercases, removes special characters, collapses whitespace.
 */
export function normalize(input: string): string {
	return (
		input
			.toLowerCase()
			.normalize("NFD")
			// biome-ignore lint/suspicious/noMisleadingCharacterClass: intentionally matching combining diacritical marks
			.replace(/[\u0300-\u036f]/g, "")
			.normalize("NFC") // Recompose so kana voiced marks and hangul jamo survive the strip below
			.replace(/[^\p{L}\p{N}\s]/gu, "") // Keep letters/numbers of all scripts, drop punctuation/symbols
			.replace(/\s+/g, " ") // Collapse whitespace
			.trim()
	)
}

/**
 * Normalize song title for matching.
 * Removes common suffixes like "(Official Video)", "[Lyrics]", etc.
 */
export function normalizeSong(song: string): string {
	return normalize(
		song
			.replace(/\s*[\(\[].*?[\)\]]\s*/g, "") // Remove parenthetical content
			.replace(/\s*[-–—]\s*(official|lyric|audio|video|visualizer|hd|hq|4k|music video).*$/i, "")
	)
}

/**
 * Normalize artist name for matching.
 * Handles "feat.", "ft.", "&", "and", etc.
 */
export function normalizeArtist(artist: string): string {
	return normalize(
		artist
			.replace(/\s*(feat\.?|ft\.?|featuring)\s+.*/i, "") // Remove featured artists
			.replace(/\s*&\s*/g, " and ") // Normalize ampersand
	)
}

const CREDIT_SEPARATOR = /\s*[,&;/×]\s*|\s+(?:and|x|feat\.?|ft\.?|featuring|with)\s+/i

function creditNames(credit: string): string[] {
	return credit
		.split(CREDIT_SEPARATOR)
		.map(normalize)
		.filter((s) => s.length > 0)
}

function creditSegments(credit: string): string {
	return `|${creditNames(credit).join("|")}|`
}

/** Matches whole separator-bounded segments, so "Ga" is not an artist in "Lady Gaga". */
export function creditIncludesArtist(credit: string, name: string): boolean {
	const whole = normalizeArtist(name)
	if (!whole) return false
	if (whole === normalizeArtist(credit)) return true
	const nameSegments = creditSegments(name)
	return nameSegments !== "||" && creditSegments(credit).includes(nameSegments)
}

/** Shares a whole credited name, or a run of consecutive names sent without separators ("Madvillain Madlib"). */
export function creditSharesArtist(credit: string, artist: string): boolean {
	if (creditIncludesArtist(credit, artist)) return true
	const names = creditNames(artist)
	if (names.length === 0) return false
	const credited = creditNames(credit)
	if (names.some((name) => credited.includes(name))) return true
	const joined = names.join(" ")
	return credited.some((_, start) =>
		credited.some((_, end) => end >= start && credited.slice(start, end + 1).join(" ") === joined)
	)
}

export function normalizeAlbum(album: string | null): string | null {
	return album ? normalize(album) : null
}

export function collapseWhitespace(input: string): string {
	return input.replace(/\s+/g, " ").trim()
}
