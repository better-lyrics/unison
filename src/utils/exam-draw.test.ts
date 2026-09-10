import { describe, expect, it } from "vitest"
import { type DrawableQuestion, type DrawSlot, drawQuestions } from "./exam-draw"

function pool(category: string, ids: number[]): DrawableQuestion[] {
	return ids.map((id) => ({ id, category }))
}

const BANK: DrawableQuestion[] = [
	...pool("seal-or-not", [10, 11, 12, 13, 14]),
	...pool("a-vs-b", [20, 21, 22]),
	...pool("what-holds-back", [30, 31, 32, 33]),
	...pool("capstone", [40, 41]),
]

const SHAPE: DrawSlot[] = [
	{ category: "seal-or-not", count: 2 },
	{ category: "a-vs-b", count: 1 },
	{ category: "what-holds-back", count: 2 },
	{ category: "capstone", count: 1 },
]

describe("drawQuestions", () => {
	it("draws the configured count from each category", () => {
		const ids = drawQuestions(BANK, SHAPE, 12345)
		expect(ids).toHaveLength(6)
	})

	it("keeps slots in shape order (each drawn id belongs to the slot at its position)", () => {
		const ids = drawQuestions(BANK, SHAPE, 777)
		const categoryOf = new Map(BANK.map((q) => [q.id, q.category]))
		const drawnCategories = ids.map((id) => categoryOf.get(id))
		expect(drawnCategories).toEqual([
			"seal-or-not",
			"seal-or-not",
			"a-vs-b",
			"what-holds-back",
			"what-holds-back",
			"capstone",
		])
	})

	it("never repeats a question within a draw", () => {
		const ids = drawQuestions(BANK, SHAPE, 42)
		expect(new Set(ids).size).toBe(ids.length)
	})

	describe("invariants", () => {
		it("is deterministic for the same seed", () => {
			expect(drawQuestions(BANK, SHAPE, 999)).toEqual(drawQuestions(BANK, SHAPE, 999))
		})

		it("does not depend on the input row order", () => {
			const shuffledBank = [...BANK].reverse()
			expect(drawQuestions(shuffledBank, SHAPE, 999)).toEqual(drawQuestions(BANK, SHAPE, 999))
		})

		it("gives different candidates partially different sets", () => {
			const a = drawQuestions(BANK, SHAPE, 1)
			const b = drawQuestions(BANK, SHAPE, 2)
			expect(a).not.toEqual(b)
		})
	})

	describe("edge cases", () => {
		it("returns an empty array for an empty shape", () => {
			expect(drawQuestions(BANK, [], 1)).toEqual([])
		})

		it("takes only what the pool has when it is smaller than the count", () => {
			const ids = drawQuestions(BANK, [{ category: "capstone", count: 5 }], 3)
			expect(ids.sort()).toEqual([40, 41])
		})

		it("returns nothing for a category with no active questions", () => {
			expect(drawQuestions(BANK, [{ category: "missing", count: 2 }], 3)).toEqual([])
		})

		it("draws every category slot independently when a category repeats is not expected", () => {
			const ids = drawQuestions(BANK, [{ category: "a-vs-b", count: 3 }], 5)
			expect(ids.sort()).toEqual([20, 21, 22])
		})
	})
})
