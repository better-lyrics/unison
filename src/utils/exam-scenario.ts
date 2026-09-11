import type { AnswerKey, AnswerKeyPart, AnswerValue } from "./exam-types"

// The top-scoring option is the correct commit; anything else ends a one-shot scenario.
function isCorrectChoice(part: AnswerKeyPart, choice: string): boolean {
	const best = Math.max(...Object.values(part.points))
	return part.points[choice] === best
}

// Order-independent: any committed beat that is not its top-scoring option ends the run.
export function isScenarioTerminated(answerKey: AnswerKey, answer: AnswerValue | null): boolean {
	if (!answer) return false
	for (const part of answerKey.parts) {
		const choice = answer[part.id]
		if (choice === undefined) continue
		if (!isCorrectChoice(part, choice)) return true
	}
	return false
}
