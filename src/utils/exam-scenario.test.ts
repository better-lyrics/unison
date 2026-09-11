import { describe, expect, it } from "vitest"
import type { AnswerKey } from "./exam-types"
import { isScenarioTerminated } from "./exam-scenario"

// A four-beat capstone: each beat's top-scoring option is the correct commit.
const KEY: AnswerKey = {
	parts: [
		{ id: "queue", points: { reject: 3, seal: -3 }, overSeal: "seal" },
		{ id: "dm", points: { hold: 3, cave: -3, rude: -1 }, overSeal: "cave" },
		{ id: "council", points: { hold: 3, cave: -3 }, overSeal: "cave" },
		{ id: "aftermath", points: { escalate: 3, cave: -3 }, overSeal: "cave" },
	],
}

describe("isScenarioTerminated", () => {
	it("is false with no answers yet", () => {
		expect(isScenarioTerminated(KEY, null)).toBe(false)
		expect(isScenarioTerminated(KEY, {})).toBe(false)
	})

	it("is false while every committed beat is the correct option", () => {
		expect(isScenarioTerminated(KEY, { queue: "reject" })).toBe(false)
		expect(isScenarioTerminated(KEY, { queue: "reject", dm: "hold" })).toBe(false)
		expect(isScenarioTerminated(KEY, { queue: "reject", dm: "hold", council: "hold" })).toBe(false)
	})

	it("is true once any committed beat holds a non-top choice", () => {
		expect(isScenarioTerminated(KEY, { queue: "seal" })).toBe(true)
		expect(isScenarioTerminated(KEY, { queue: "reject", dm: "cave" })).toBe(true)
	})

	it("treats a partial-credit choice as wrong (it is not the top option)", () => {
		// rude scores -1, better than cave's -3 but still not the correct hold.
		expect(isScenarioTerminated(KEY, { queue: "reject", dm: "rude" })).toBe(true)
	})

	describe("edge cases", () => {
		it("ignores unknown choice ids (scored zero, not the top) as wrong", () => {
			expect(isScenarioTerminated(KEY, { queue: "made-up" })).toBe(true)
		})

		it("treats a tie for top as correct for either tied option", () => {
			const tie: AnswerKey = { parts: [{ id: "a", points: { x: 3, y: 3, z: 0 } }] }
			expect(isScenarioTerminated(tie, { a: "x" })).toBe(false)
			expect(isScenarioTerminated(tie, { a: "y" })).toBe(false)
			expect(isScenarioTerminated(tie, { a: "z" })).toBe(true)
		})
	})
})
