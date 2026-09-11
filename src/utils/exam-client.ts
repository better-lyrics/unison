import type { ExamQuestionType } from "./exam-types"

// Reads only named fields so the private answer key and weight never ride along to the client.
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
