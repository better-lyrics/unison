import { hash32, mulberry32 } from "./seeded-rng"

export interface DrawableQuestion {
	id: number
	category: string
}

export interface DrawSlot {
	category: string
	count: number
}

function seededShuffle<T>(items: T[], rand: () => number): T[] {
	const out = [...items]
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1))
		;[out[i], out[j]] = [out[j], out[i]]
	}
	return out
}

// Deterministic, stratified draw. Each slot draws `count` questions from its
// category pool. The pool is sorted by id first so the result never depends on
// the order rows came back from the DB, then shuffled with a per-slot seed so
// two candidates (different `seed`) overlap only partially.
export function drawQuestions(
	bank: DrawableQuestion[],
	shape: readonly DrawSlot[],
	seed: number
): number[] {
	const byCategory = new Map<string, number[]>()
	for (const q of bank) {
		const ids = byCategory.get(q.category)
		if (ids) ids.push(q.id)
		else byCategory.set(q.category, [q.id])
	}

	const drawn: number[] = []
	for (const slot of shape) {
		const pool = (byCategory.get(slot.category) ?? []).slice().sort((a, b) => a - b)
		const rand = mulberry32((seed ^ hash32(slot.category)) >>> 0)
		drawn.push(...seededShuffle(pool, rand).slice(0, Math.max(0, slot.count)))
	}
	return drawn
}
