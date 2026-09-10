import type { ExamQuestionType } from "./exam-types"

// The subset of a stored question the client may see. It is intentionally a
// structural superset of the DB SessionQuestion so a row can be passed directly,
// but the transform reads only named fields so the private answer key and weight
// can never ride along.
export interface ClientQuestionInput {
	questionId: number
	type: ExamQuestionType
	category: string
	prompt: string
	assets: unknown | null
	choices: unknown | null
	steps: unknown | null
}

export interface ClientQuestion {
	id: number
	type: ExamQuestionType
	category: string
	prompt: string
	assets?: unknown
	choices?: unknown
	steps?: unknown
}

export function toClientQuestion(q: ClientQuestionInput): ClientQuestion {
	const out: ClientQuestion = {
		id: q.questionId,
		type: q.type,
		category: q.category,
		prompt: q.prompt,
	}
	if (q.assets != null) out.assets = q.assets
	if (q.choices != null) out.choices = q.choices
	if (q.steps != null) out.steps = q.steps
	return out
}
