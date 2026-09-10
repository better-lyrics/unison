export type ExamQuestionType = "timing" | "mcq" | "scenario"

// A scoring part is one decision the candidate makes (a verdict, a reason, one
// scenario beat). `points` maps each choice id to its raw points, which may be
// negative. `overSeal` names the choice whose negative points are amplified by
// the over-seal penalty ratio, so wrongly sealing costs more than wrongly
// rejecting. All of this is private answer-key data and lives only in the DB.
export interface AnswerKeyPart {
	id: string
	points: Record<string, number>
	overSeal?: string
}

export interface AnswerKey {
	parts: AnswerKeyPart[]
}

// A candidate answer maps each part id to the chosen choice id. A missing part
// is unanswered and scores zero (a blank is never an over-seal).
export type AnswerValue = Record<string, string>

export interface GradeableItem {
	questionId: number
	category: string
	weight: number
	answerKey: AnswerKey
	answer: AnswerValue | null
}

export interface GradedQuestion {
	questionId: number
	category: string
	awardedPoints: number
	maxPoints: number
}

export interface AreaBreakdown {
	category: string
	score: number
	max: number
}

export interface ExamGrade {
	questions: GradedQuestion[]
	score: number
	maxScore: number
	scorePct: number
	breakdown: AreaBreakdown[]
	passed: boolean
}
