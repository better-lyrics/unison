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

// Sort by id before shuffling so the draw is DB-order-independent; repeated slots draw distinct ids.
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
	const used = new Set<number>()
	shape.forEach((slot, slotIndex) => {
		const pool = (byCategory.get(slot.category) ?? [])
			.slice()
			.sort((a, b) => a - b)
			.filter((id) => !used.has(id))
		const rand = mulberry32((seed ^ hash32(`${slot.category}:${slotIndex}`)) >>> 0)
		for (const id of seededShuffle(pool, rand).slice(0, Math.max(0, slot.count))) {
			used.add(id)
			drawn.push(id)
		}
	})
	return drawn
}
