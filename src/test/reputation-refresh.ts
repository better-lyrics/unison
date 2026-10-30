import { config } from "@/config"

export const isReputationRefresh = (sql: string): boolean =>
	sql.includes("UPDATE users SET reputation = d.reputation") && sql.includes("= ANY(?::int[])")

export const refreshParams = (userIds: number[]): unknown[] => [
	config.reputation.minVotesForConfidence,
	userIds,
	userIds,
	userIds,
	config.reputation.min,
	config.reputation.max,
	config.reputation.default,
	config.reputation.consensusDelta,
	-config.moderation.autoHide.reputationPenalty,
	-config.voteIntegrity.repeatPenalty.reputation,
	userIds,
]
