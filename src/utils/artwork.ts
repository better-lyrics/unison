const SIZE_SUFFIX = /=w(\d+)-h(\d+)/

export function isAlbumArtUrl(url: string | null | undefined): boolean {
	if (!url || typeof url !== "string") return false
	if (!/^https?:\/\/[^/]*googleusercontent\.com\//.test(url)) return false
	const m = url.match(SIZE_SUFFIX)
	if (!m) return false
	return m[1] === m[2]
}

export function normalizeArtworkUrl(url: string, size: number): string {
	return url.replace(SIZE_SUFFIX, `=w${size}-h${size}`)
}

export function pickSquareArtwork(
	thumbs: { url: string; width: number; height: number }[],
	size: number
): string | null {
	const squares = thumbs.filter((t) => t.width === t.height && t.width > 0)
	if (squares.length === 0) return null
	const largest = squares.reduce((a, b) => (b.width > a.width ? b : a))
	return normalizeArtworkUrl(largest.url, size)
}
