export interface Histogram {
	total: number
	atLeast: Record<number, number>
}

export function coverageAtLeast(hist: Histogram, threshold: number): number {
	if (hist.total <= 0) return 0
	return (hist.atLeast[threshold] ?? 0) / hist.total
}

export function deriveThreshold(
	hist: Histogram,
	targetFraction: number,
	opts: { floor: number; ceil: number }
): number {
	const { floor, ceil } = opts
	if (hist.total <= 0) return floor
	for (let t = floor; t <= ceil; t++) {
		if (coverageAtLeast(hist, t) <= targetFraction) return t
	}
	return ceil
}

export interface DriftResult {
	name: string
	current: number
	recommended: number
	currentCoverage: number
	targetFraction: number
	drifted: boolean
}

export function checkDrift(params: {
	name: string
	hist: Histogram
	current: number
	targetFraction: number
	floor: number
	ceil: number
	tolerance: number
}): DriftResult {
	const { name, hist, current, targetFraction, floor, ceil, tolerance } = params
	const recommended = deriveThreshold(hist, targetFraction, { floor, ceil })
	const currentCoverage = coverageAtLeast(hist, current)
	const drifted =
		hist.total > 0 &&
		recommended !== current &&
		Math.abs(currentCoverage - targetFraction) > tolerance
	return { name, current, recommended, currentCoverage, targetFraction, drifted }
}
