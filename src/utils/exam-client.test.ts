import { describe, expect, it } from "vitest"
import { type ClientQuestionInput, toClientQuestion } from "./exam-client"

const base: ClientQuestionInput = {
	questionId: 7,
	type: "timing",
	category: "seal-or-not",
	prompt: "Is this seal-worthy?",
	assets: { clip: { ttml: "<tt/>", source: { videoId: "abc", start: 10, end: 20 } } },
	choices: [{ id: "seal", label: "Seal" }],
	steps: null,
}

describe("toClientQuestion", () => {
	it("renames questionId to id and passes prompt, assets, and choices through", () => {
		const out = toClientQuestion(base)
		expect(out.id).toBe(7)
		expect(out.type).toBe("timing")
		expect(out.prompt).toBe("Is this seal-worthy?")
		expect(out.assets).toEqual(base.assets)
		expect(out.choices).toEqual(base.choices)
	})

	it("omits null assets, choices, and steps", () => {
		const out = toClientQuestion({ ...base, assets: null, choices: null, steps: null })
		expect("assets" in out).toBe(false)
		expect("choices" in out).toBe(false)
		expect("steps" in out).toBe(false)
	})

	it("includes scenario steps when present", () => {
		const out = toClientQuestion({
			...base,
			type: "scenario",
			assets: null,
			choices: null,
			steps: [{ id: "beat1", kind: "dm" }],
		})
		expect(out.steps).toEqual([{ id: "beat1", kind: "dm" }])
	})

	describe("invariants", () => {
		it("never leaks the answer key or weight, even if present on the input", () => {
			const withSecrets = {
				...base,
				answerKey: { parts: [{ id: "verdict", points: { no: 3 } }] },
				weight: 5,
			} as unknown as ClientQuestionInput
			const out = toClientQuestion(withSecrets)
			expect("answerKey" in out).toBe(false)
			expect("weight" in out).toBe(false)
			expect(JSON.stringify(out)).not.toContain("answerKey")
			expect(JSON.stringify(out)).not.toContain("points")
		})
	})
})
