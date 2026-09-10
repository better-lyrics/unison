import { describe, expect, it } from "vitest"
import { gradeExam } from "./exam-grading"
import type { GradeableItem } from "./exam-types"

const OPTS = { cutoffPct: 0.85, overSealPenaltyRatio: 2 }

// A seal-or-not clip whose correct verdict is "no". Sealing it is the failure
// mode: the seal choice carries a negative base amplified by the over-seal ratio.
function sealOrNot(questionId: number, answer: GradeableItem["answer"]): GradeableItem {
	return {
		questionId,
		category: "seal-or-not",
		weight: 1,
		answerKey: {
			parts: [
				{ id: "verdict", points: { no: 3, seal: -1 }, overSeal: "seal" },
				{ id: "reason", points: { "flaw-timing": 2, "flaw-bg": 0, "flaw-none": 0 } },
			],
		},
		answer,
	}
}

describe("gradeExam", () => {
	describe("verdict plus reason", () => {
		it("gives full credit for the correct verdict and the correct reason", () => {
			const grade = gradeExam([sealOrNot(1, { verdict: "no", reason: "flaw-timing" })], OPTS)
			expect(grade.questions[0].awardedPoints).toBe(5)
			expect(grade.questions[0].maxPoints).toBe(5)
		})

		it("gives partial credit for the right verdict with the wrong reason", () => {
			const grade = gradeExam([sealOrNot(1, { verdict: "no", reason: "flaw-bg" })], OPTS)
			expect(grade.questions[0].awardedPoints).toBe(3)
			expect(grade.questions[0].maxPoints).toBe(5)
		})
	})

	describe("asymmetric penalty", () => {
		it("makes wrongly sealing cost more than wrongly rejecting", () => {
			const overSeal: GradeableItem = {
				questionId: 1,
				category: "seal-or-not",
				weight: 1,
				answerKey: { parts: [{ id: "verdict", points: { no: 3, seal: -1 }, overSeal: "seal" }] },
				answer: { verdict: "seal" },
			}
			const overReject: GradeableItem = {
				questionId: 2,
				category: "a-vs-b",
				weight: 1,
				answerKey: { parts: [{ id: "verdict", points: { seal: 3, no: -1 } }] },
				answer: { verdict: "no" },
			}
			const sealPoints = gradeExam([overSeal], OPTS).questions[0].awardedPoints
			const rejectPoints = gradeExam([overReject], OPTS).questions[0].awardedPoints
			expect(sealPoints).toBe(-2) // -1 base amplified by the 2x ratio
			expect(rejectPoints).toBe(-1)
			expect(sealPoints).toBeLessThan(rejectPoints)
		})

		it("does not amplify a positive over-seal choice", () => {
			const item: GradeableItem = {
				questionId: 1,
				category: "seal-or-not",
				weight: 1,
				answerKey: { parts: [{ id: "verdict", points: { seal: 2, no: 0 }, overSeal: "seal" }] },
				answer: { verdict: "seal" },
			}
			expect(gradeExam([item], OPTS).questions[0].awardedPoints).toBe(2)
		})
	})

	describe("weight", () => {
		it("scales both awarded and max points by the question weight", () => {
			const item: GradeableItem = {
				questionId: 1,
				category: "capstone",
				weight: 4,
				answerKey: { parts: [{ id: "p", points: { right: 3, wrong: 0 } }] },
				answer: { right: "right" },
			}
			// answer key id is "p", not "right" -> unanswered -> 0
			expect(gradeExam([item], OPTS).questions[0].maxPoints).toBe(12)
		})
	})

	describe("cutoff boundary", () => {
		const boundary = (choice: string): GradeableItem => ({
			questionId: 1,
			category: "mcq",
			weight: 1,
			answerKey: { parts: [{ id: "p", points: { a: 100, b: 84, c: 85 } }] },
			answer: { p: choice },
		})

		it("passes at exactly the cutoff", () => {
			const grade = gradeExam([boundary("c")], OPTS)
			expect(grade.scorePct).toBeCloseTo(0.85)
			expect(grade.passed).toBe(true)
		})

		it("fails just below the cutoff", () => {
			const grade = gradeExam([boundary("b")], OPTS)
			expect(grade.scorePct).toBeCloseTo(0.84)
			expect(grade.passed).toBe(false)
		})
	})

	describe("breakdown", () => {
		it("groups awarded and max points by category", () => {
			const grade = gradeExam(
				[
					sealOrNot(1, { verdict: "no", reason: "flaw-timing" }),
					sealOrNot(2, { verdict: "no", reason: "flaw-bg" }),
					{
						questionId: 3,
						category: "mcq",
						weight: 2,
						answerKey: { parts: [{ id: "p", points: { a: 1, b: 0 } }] },
						answer: { p: "a" },
					},
				],
				OPTS
			)
			const byCat = new Map(grade.breakdown.map((b) => [b.category, b]))
			expect(byCat.get("seal-or-not")).toEqual({ category: "seal-or-not", score: 8, max: 10 })
			expect(byCat.get("mcq")).toEqual({ category: "mcq", score: 2, max: 2 })
		})

		it("sums breakdown maxes to the exam maxScore", () => {
			const grade = gradeExam([sealOrNot(1, null), sealOrNot(2, null)], OPTS)
			const totalMax = grade.breakdown.reduce((s, b) => s + b.max, 0)
			expect(totalMax).toBe(grade.maxScore)
		})
	})

	describe("invariants", () => {
		it("never reports a score above maxScore", () => {
			const grade = gradeExam([sealOrNot(1, { verdict: "no", reason: "flaw-timing" })], OPTS)
			expect(grade.score).toBeLessThanOrEqual(grade.maxScore)
		})

		it("clamps a heavily penalized total to zero, never negative", () => {
			const grade = gradeExam(
				[
					{
						questionId: 1,
						category: "seal-or-not",
						weight: 1,
						answerKey: { parts: [{ id: "v", points: { no: 3, seal: -5 }, overSeal: "seal" }] },
						answer: { v: "seal" },
					},
				],
				OPTS
			)
			expect(grade.questions[0].awardedPoints).toBe(-10)
			expect(grade.score).toBe(0)
			expect(grade.scorePct).toBe(0)
		})
	})

	describe("edge cases", () => {
		it("scores an unanswered exam as zero and fails it", () => {
			const grade = gradeExam([sealOrNot(1, null), sealOrNot(2, null)], OPTS)
			expect(grade.score).toBe(0)
			expect(grade.maxScore).toBe(10)
			expect(grade.passed).toBe(false)
		})

		it("returns an empty, failing grade for no questions", () => {
			const grade = gradeExam([], OPTS)
			expect(grade).toMatchObject({ score: 0, maxScore: 0, scorePct: 0, passed: false })
			expect(grade.breakdown).toEqual([])
		})

		it("scores an unknown choice id as zero for that part", () => {
			const grade = gradeExam([sealOrNot(1, { verdict: "maybe", reason: "flaw-timing" })], OPTS)
			expect(grade.questions[0].awardedPoints).toBe(2)
		})

		it("ignores answer keys for parts the candidate did not touch", () => {
			const grade = gradeExam([sealOrNot(1, { verdict: "no" })], OPTS)
			expect(grade.questions[0].awardedPoints).toBe(3)
		})
	})
})
