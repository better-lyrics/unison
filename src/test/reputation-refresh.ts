import { config } from "@/config"

export const isReputationRefresh = (sql: string): boolean =>
	sql.includes("UPDATE users SET reputation = d.reputation") && sql.includes("WHERE u.id IN (")

export const refreshParams = (userIds: number[]): unknown[] => [
	config.reputation.minVotesForConfidence,
	config.reputation.min,
	config.reputation.max,
	config.reputation.default,
	config.reputation.consensusDelta,
	-config.moderation.autoHide.reputationPenalty,
	...userIds,
]
