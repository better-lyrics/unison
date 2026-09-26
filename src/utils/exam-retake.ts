import type { ExamSessionState } from "@/db/exam"

export interface ExamAttemptOutcome {
	state: ExamSessionState
	submittedAt: number | null
	decidedAt: number | null
}

export function retakeAvailableAt(attempt: ExamAttemptOutcome, cooldownSec: number): number | null {
	const anchor =
		attempt.state === "failed"
			? attempt.submittedAt
			: attempt.state === "rejected"
				? (attempt.decidedAt ?? attempt.submittedAt)
				: null
	return anchor === null ? null : anchor + cooldownSec
}

export function canStartNewAttempt(
	latest: ExamAttemptOutcome | null,
	cooldownSec: number,
	now: number
): boolean {
	if (latest === null) return true
	const retakeAt = retakeAvailableAt(latest, cooldownSec)
	return retakeAt !== null && now >= retakeAt
}
