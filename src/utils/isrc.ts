const ISRC_PATTERN = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/

export const ISRC_HINT =
	"That doesn't look like an ISRC. It's 12 letters and numbers, like USRC17607839. Leave it blank if you don't have one."

export function normalizeIsrc(input: string): string | null {
	const candidate = input.normalize("NFKC").replace(/[\s-]/g, "").toUpperCase()
	return ISRC_PATTERN.test(candidate) ? candidate : null
}
