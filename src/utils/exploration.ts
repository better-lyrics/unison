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

function gammaInt(shape: number, rand: () => number): number {
	let sum = 0
	for (let i = 0; i < shape; i++) {
		// map [0, 1) to (0, 1] so the log argument is never zero
		const u = 1 - rand()
		sum -= Math.log(u)
	}
	return sum
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
		const ga = gammaInt(arm.upvotes + 1, rand)
		const gb = gammaInt(arm.downvotes + 1, rand)
		const total = ga + gb
		const theta = total === 0 ? 0.5 : ga / total
		if (theta > bestTheta) {
			bestTheta = theta
			best = arm
		}
	}

	return best
}
