import { config } from "@/config"
import type { GateOutcome, PendingReason } from "@/types"

export interface GateInput {
	sealed: boolean
	jevFlagged: boolean
	textDrift: number
	timingDrift: number
}

const pendingFor = (reason: PendingReason): GateOutcome => ({ goesLive: false, reason })

export function decideOutcome(input: GateInput): GateOutcome {
	if (input.sealed) return pendingFor("sealed")
	if (input.textDrift > config.revisions.textDriftLimit) return pendingFor("large_text_drift")
	if (input.timingDrift > config.revisions.timingDriftLimit) return pendingFor("large_timing_drift")
	if (input.jevFlagged) return pendingFor("flagged")
	return { goesLive: true, reason: null }
}
