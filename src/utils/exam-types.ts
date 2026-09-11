export type ExamQuestionType = "timing" | "mcq" | "scenario"

// overSeal names the choice whose negative points are amplified so wrongly sealing costs the most.
export interface AnswerKeyPart {
	id: string
	points: Record<string, number>
	overSeal?: string
}

export interface AnswerKey {
	parts: AnswerKeyPart[]
}

// A missing part is unanswered and scores zero; a blank is never an over-seal.
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
