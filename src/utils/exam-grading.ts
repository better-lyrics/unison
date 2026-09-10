import type {
	AnswerKey,
	AnswerKeyPart,
	AnswerValue,
	AreaBreakdown,
	ExamGrade,
	GradeableItem,
} from "./exam-types"

interface GradeOptions {
	cutoffPct: number
	overSealPenaltyRatio: number
}

// The captured question plus its answer, before grading. A structural superset
// of the DB SessionQuestion so a row can be passed directly.
interface GradeableSource {
	questionId: number
	category: string
	weight: number
	answerKey: AnswerKey
	answer: AnswerValue | null
}

// A freshly submitted answer wins over the autosaved one; an untouched question
// stays unanswered (scored zero, never an over-seal).
export function toGradeableItems(
	questions: GradeableSource[],
	submitted: Record<string, AnswerValue>
): GradeableItem[] {
	return questions.map((q) => ({
		questionId: q.questionId,
		category: q.category,
		weight: q.weight,
		answerKey: q.answerKey,
		answer: submitted[String(q.questionId)] ?? q.answer ?? null,
	}))
}

function partMax(part: AnswerKeyPart): number {
	return Math.max(0, ...Object.values(part.points))
}

function partAwarded(part: AnswerKeyPart, answer: AnswerValue | null, ratio: number): number {
	const chosen = answer?.[part.id]
	if (chosen === undefined) return 0
	const base = part.points[chosen] ?? 0
	if (part.overSeal === chosen && base < 0) return base * ratio
	return base
}

export function gradeExam(items: GradeableItem[], opts: GradeOptions): ExamGrade {
	const questions = items.map((item) => {
		const maxPoints = item.weight * item.answerKey.parts.reduce((s, p) => s + partMax(p), 0)
		const awardedPoints =
			item.weight *
			item.answerKey.parts.reduce(
				(s, p) => s + partAwarded(p, item.answer, opts.overSealPenaltyRatio),
				0
			)
		return { questionId: item.questionId, category: item.category, awardedPoints, maxPoints }
	})

	const maxScore = questions.reduce((s, q) => s + q.maxPoints, 0)
	const rawScore = questions.reduce((s, q) => s + q.awardedPoints, 0)
	const score = Math.min(maxScore, Math.max(0, rawScore))
	const scorePct = maxScore > 0 ? score / maxScore : 0

	const breakdownMap = new Map<string, AreaBreakdown>()
	for (const q of questions) {
		const area = breakdownMap.get(q.category) ?? { category: q.category, score: 0, max: 0 }
		area.score += q.awardedPoints
		area.max += q.maxPoints
		breakdownMap.set(q.category, area)
	}

	return {
		questions,
		score,
		maxScore,
		scorePct,
		breakdown: [...breakdownMap.values()],
		passed: scorePct >= opts.cutoffPct,
	}
}
