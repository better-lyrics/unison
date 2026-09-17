import type { AnswerKey, AnswerKeyPart, AnswerValue } from "./exam-types"

// Only a negative score ends a one-shot scenario; zero or positive is acceptable and plays on.
function endsScenario(part: AnswerKeyPart, choice: string): boolean {
	return (part.points[choice] ?? 0) < 0
}

// Order-independent: any committed beat that scores negative ends the run.
export function isScenarioTerminated(answerKey: AnswerKey, answer: AnswerValue | null): boolean {
	if (!answer) return false
	for (const part of answerKey.parts) {
		const choice = answer[part.id]
		if (choice === undefined) continue
		if (endsScenario(part, choice)) return true
	}
	return false
}
