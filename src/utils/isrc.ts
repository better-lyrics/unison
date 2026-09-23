const ISRC_PATTERN = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/

export function normalizeIsrc(input: string): string | null {
	const candidate = input.normalize("NFKC").replace(/[\s-]/g, "").toUpperCase()
	return ISRC_PATTERN.test(candidate) ? candidate : null
}
