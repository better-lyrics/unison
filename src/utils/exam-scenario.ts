import type { AnswerKey, AnswerKeyPart, AnswerValue } from "./exam-types"

// The top-scoring option of a beat is the correct commit. In a one-shot scenario
// (the capstone), anything else is a wrong pick that ends the story.
function isCorrectChoice(part: AnswerKeyPart, choice: string): boolean {
	const best = Math.max(...Object.values(part.points))
	return part.points[choice] === best
}

// A one-shot scenario terminates at the first committed beat answered with a choice
// that is not that beat's top-scoring option. Order-independent: any committed wrong
// beat means the run has ended.
export function isScenarioTerminated(answerKey: AnswerKey, answer: AnswerValue | null): boolean {
	if (!answer) return false
	for (const part of answerKey.parts) {
		const choice = answer[part.id]
		if (choice === undefined) continue
		if (!isCorrectChoice(part, choice)) return true
	}
	return false
}
