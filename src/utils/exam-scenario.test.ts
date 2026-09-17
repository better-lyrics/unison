import { describe, expect, it } from "vitest"
import { isScenarioTerminated } from "./exam-scenario"
import type { AnswerKey } from "./exam-types"

// A beat ends the run only when its committed choice scores negative; rude scores positive, so it plays on.
const KEY: AnswerKey = {
	parts: [
		{ id: "queue", points: { reject: 3, seal: -3 }, overSeal: "seal" },
		{ id: "dm", points: { hold: 3, cave: -3, rude: 2 }, overSeal: "cave" },
		{ id: "council", points: { hold: 3, cave: -3 }, overSeal: "cave" },
		{ id: "aftermath", points: { escalate: 3, cave: -3 }, overSeal: "cave" },
	],
}

describe("isScenarioTerminated", () => {
	it("is false with no answers yet", () => {
		expect(isScenarioTerminated(KEY, null)).toBe(false)
		expect(isScenarioTerminated(KEY, {})).toBe(false)
	})

	it("is false while every committed beat scores non-negative", () => {
		expect(isScenarioTerminated(KEY, { queue: "reject" })).toBe(false)
		expect(isScenarioTerminated(KEY, { queue: "reject", dm: "hold" })).toBe(false)
		expect(isScenarioTerminated(KEY, { queue: "reject", dm: "hold", council: "hold" })).toBe(false)
	})

	it("is true once any committed beat holds a negative-scoring choice", () => {
		expect(isScenarioTerminated(KEY, { queue: "seal" })).toBe(true)
		expect(isScenarioTerminated(KEY, { queue: "reject", dm: "cave" })).toBe(true)
	})

	it("lets a blunt-but-correct reply play on (positive, below the top, never ends the run)", () => {
		expect(isScenarioTerminated(KEY, { queue: "reject", dm: "rude" })).toBe(false)
	})

	describe("edge cases", () => {
		it("does not end the run on a zero-scoring choice", () => {
			const zero: AnswerKey = { parts: [{ id: "a", points: { x: 3, y: 0 } }] }
			expect(isScenarioTerminated(zero, { a: "y" })).toBe(false)
		})

		it("treats an unknown choice id as zero, so it does not end the run", () => {
			expect(isScenarioTerminated(KEY, { queue: "made-up" })).toBe(false)
		})

		it("ends the run only on the negative option among several", () => {
			const mix: AnswerKey = { parts: [{ id: "a", points: { x: 3, y: 2, z: -1 } }] }
			expect(isScenarioTerminated(mix, { a: "x" })).toBe(false)
			expect(isScenarioTerminated(mix, { a: "y" })).toBe(false)
			expect(isScenarioTerminated(mix, { a: "z" })).toBe(true)
		})
	})
})
