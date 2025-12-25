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
			.replace(/[^\w\s]/g, "") // Remove special characters
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
