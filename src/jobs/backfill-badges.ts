import { config } from "@/config"
import { type AwardedBadge, evaluateAndAward } from "@/db/badges"
import { Logger } from "@/infra/logger"
import type { Env } from "@/types"

const log = new Logger("backfill-badges")

export async function backfillBadges(env: Env): Promise<{ evaluated: number; awarded: number }> {
	const blacklisted = [...config.linking.blacklistedKeyIds]

	const parts = [
		"SELECT DISTINCT user_id FROM contribution_events",
		"SELECT user_id FROM committee_members",
	]
	if (blacklisted.length > 0) {
		parts.push(
			`SELECT id AS user_id FROM users WHERE key_id IN (${blacklisted.map(() => "?").join(", ")})`
		)
	}
	const sql = parts.join(" UNION ")

	const earners = await env.DB.prepare(sql)
		.bind(...blacklisted)
		.all<{ user_id: number }>()

	let evaluated = 0
	let awarded = 0
	for (const { user_id } of earners.results || []) {
		const badges = await evaluateAndAward(env, user_id).catch((err) => {
			log.error("badge eval failed", { userId: user_id, error: (err as Error).message })
			return [] as AwardedBadge[]
		})
		evaluated++
		if (badges.length > 0) awarded++
	}

	return { evaluated, awarded }
}
