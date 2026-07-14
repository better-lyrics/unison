import { config } from "@/config"
import type { Confidence } from "@/types"

type SyncType = "richsync" | "linesync" | "plain"

function hash32(str: string): number {
	let h = 0
	for (let i = 0; i < str.length; i++) {
		h = (h << 5) - h + str.charCodeAt(i)
		h |= 0
	}
	return h >>> 0
}

export function hashBucket(keyId: string, videoId: string): number {
	return hash32(`${keyId}:${videoId}`) / 0x100000000
}

export function hashSeed(keyId: string, videoId: string): number {
	return hash32(`${keyId}:${videoId}`)
}

export function epsilonForTier(confidence: Confidence): number {
	return config.exploration.epsilon[confidence] ?? 0
}

export function allowedSyncTiers(incumbentSyncType: SyncType): Set<SyncType> {
	switch (incumbentSyncType) {
		case "richsync":
			return new Set(["richsync"])
		case "linesync":
			return new Set(["linesync", "richsync"])
		case "plain":
			return new Set(["plain", "linesync", "richsync"])
	}
}

function mulberry32(seed: number) {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) | 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

// Standard normal via Box-Muller. u1 is mapped to (0, 1] so log never sees zero.
function sampleNormal(rand: () => number): number {
	const u1 = 1 - rand()
	const u2 = rand()
	return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

// Draw from Gamma(shape, 1) in constant time (Marsaglia-Tsang). The previous
// implementation summed `shape` exponentials, so an arm whose vote count grew
// large (upvotes/downvotes drift from the separately resynced vote_count) spun
// the event loop for minutes to forever. Non-finite or non-positive shapes come
// only from corrupt counts; they are clamped so they can never spin.
function sampleGamma(shape: number, rand: () => number): number {
	if (!(shape > 0)) return 0
	const k = Number.isFinite(shape) ? shape : Number.MAX_SAFE_INTEGER
	if (k < 1) {
		return sampleGamma(k + 1, rand) * (1 - rand()) ** (1 / k)
	}
	const d = k - 1 / 3
	const c = 1 / Math.sqrt(9 * d)
	for (;;) {
		let x: number
		let v: number
		do {
			x = sampleNormal(rand)
			v = 1 + c * x
		} while (v <= 0)
		v = v * v * v
		const u = rand()
		if (u < 1 - 0.0331 * x * x * x * x) return d * v
		if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
	}
}

export function selectArm<T extends { upvotes: number; downvotes: number }>(
	challengers: T[],
	seed: number
): T {
	if (challengers.length === 0) {
		throw new Error("selectArm: empty pool")
	}
	if (challengers.length === 1) {
		return challengers[0]
	}

	const rand = mulberry32(seed)
	let best = challengers[0]
	let bestTheta = -1

	for (const arm of challengers) {
		const ga = sampleGamma(arm.upvotes + 1, rand)
		const gb = sampleGamma(arm.downvotes + 1, rand)
		const total = ga + gb
		const theta = total === 0 ? 0.5 : ga / total
		if (theta > bestTheta) {
			bestTheta = theta
			best = arm
		}
	}

	return best
}
