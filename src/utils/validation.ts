export function validateTtmlStructure(ttml: string): boolean {
	const hasRoot = /<tt[\s>]/i.test(ttml)
	const hasBody = /<body[\s>]/i.test(ttml) || /<body\/>/i.test(ttml)
	const hasClosingTt = /<\/tt>/i.test(ttml)

	if (!hasRoot || !hasClosingTt) {
		return false
	}

	const divCount = (ttml.match(/<div[\s>]/gi) || []).length
	const pCount = (ttml.match(/<p[\s>]/gi) || []).length

	if (divCount === 0 && pCount === 0 && !hasBody) {
		return false
	}

	return true
}

export function detectSyncType(ttml: string): "richsync" | "linesync" | "plain" {
	const hasWordTimings = /<span[^>]*begin=/i.test(ttml) && /<span[^>]*end=/i.test(ttml)
	if (hasWordTimings) {
		return "richsync"
	}

	const hasLineTimings = /<p[^>]*begin=/i.test(ttml) || /<div[^>]*begin=/i.test(ttml)
	if (hasLineTimings) {
		return "linesync"
	}

	return "plain"
}
