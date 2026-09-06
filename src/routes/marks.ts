import { config } from "@/config"
import { getBadgeSummaries } from "@/db/badge-summary"
import { getXpForUsers } from "@/db/contribution-events"
import { getCuratorTierMap } from "@/db/leaderboard"
import type { Env, Mark, MarkActor } from "@/types"
import { generatePetName } from "@/utils/petname"
import { levelForXp } from "@/utils/xp"

export async function resolveActors(
	env: Env,
	userIds: (number | null | undefined)[]
): Promise<Map<number, MarkActor>> {
	const ids = [...new Set(userIds.filter((id): id is number => id != null))]
	if (ids.length === 0) return new Map()

	const placeholders = ids.map(() => "?").join(", ")
	const [{ results }, tierMap, xpMap, summaries] = await Promise.all([
		env.DB.prepare(`SELECT id, key_id, nickname FROM users WHERE id IN (${placeholders})`)
			.bind(...ids)
			.all<{ id: number | string; key_id: string; nickname: string | null }>(),
		getCuratorTierMap(env),
		getXpForUsers(env, ids),
		getBadgeSummaries(env, ids),
	])

	const actors = new Map<number, MarkActor>()
	for (const user of results) {
		const id = Number(user.id)
		const summary = summaries.get(id)
		actors.set(id, {
			keyId: user.key_id,
			displayName: user.nickname ?? generatePetName(user.key_id),
			tier: tierMap.get(user.key_id) ?? null,
			level: levelForXp(xpMap.get(id) ?? 0, config.gamification.xp.levelThresholds).level,
			badgeCount: summary?.badgeCount ?? 0,
			topBadge: summary?.topBadge ?? null,
		})
	}
	return actors
}

export async function buildSealMarks(
	env: Env,
	rows: {
		id: number
		committee_approved_at?: number | null
		committee_approved_by?: number | null
	}[]
): Promise<Map<number, Mark[]>> {
	const approved = rows.filter(
		(r) => r.committee_approved_at != null && r.committee_approved_by != null
	)
	if (approved.length === 0) return new Map()

	const actors = await resolveActors(
		env,
		approved.map((r) => r.committee_approved_by)
	)

	const marks = new Map<number, Mark[]>()
	for (const r of approved) {
		marks.set(Number(r.id), [
			{
				type: "seal",
				label: config.gamification.seal.label,
				icon: "/badges/committee/image.svg",
				by: actors.get(Number(r.committee_approved_by)),
				at: Number(r.committee_approved_at),
			},
		])
	}
	return marks
}
