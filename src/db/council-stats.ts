import { config } from "@/config"
import { type BoostQuota, getQuota, monthWindow } from "@/db/boost"
import { DECISION_KINDS, UNDONE_EXPR } from "@/db/council-events"
import { type CouncilPerson, withTier } from "@/db/council-person"
import { getCuratorTierMap } from "@/db/leaderboard"
import { resolvePeople } from "@/db/users"
import type { Env } from "@/types"

const DAY = 86400
const CHART_DAYS = 30
const MEDIAN_WINDOW = 30 * DAY
const SPLIT_WINDOW = 7 * DAY

export interface DayDecisions {
	day: number
	sealed: number
	rejected: number
	editsReviewed: number
}

export interface CouncilOverview {
	decisionsByDay: DayDecisions[]
	medianDecisionHours: { current: number | null; previous: number | null }
	sealRate: number | null
	sourceSplit: { web: number; discord: number }
	me: {
		quota: BoostQuota
		rejectsThisMonth: number
		editsThisMonth: number
		medianDecisionHours: number | null
		bookmarkCap: number
		bookmarkTtlSec: number
	}
}

const DECIDED = `e.kind = ANY(?) AND NOT (${UNDONE_EXPR})`

const WAIT_SECONDS = `e.created_at - CASE
	WHEN e.kind IN ('edit_approve', 'edit_reject') THEN (SELECT r.created_at FROM lyric_revisions r WHERE r.id = e.ref_id)
	ELSE (SELECT l.created_at FROM lyrics l WHERE l.id = e.lyrics_id)
END`

async function medianHours(
	env: Env,
	from: number,
	to: number,
	actorId: number | null
): Promise<number | null> {
	const row = await env.DB.prepare(
		`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY wait) AS median
		 FROM (
			SELECT ${WAIT_SECONDS} AS wait
			FROM council_events e
			WHERE ${DECIDED} AND e.created_at >= ? AND e.created_at < ?
				AND (?::int IS NULL OR e.actor_id = ?)
		 ) waits
		 WHERE wait IS NOT NULL AND wait >= 0`
	)
		.bind(DECISION_KINDS, from, to, actorId, actorId)
		.first<{ median: number | string | null }>()
	return row?.median === null || row?.median === undefined ? null : Number(row.median) / 3600
}

export async function getCouncilOverview(
	env: Env,
	opts: { meId: number; scope: "council" | "me"; now?: number }
): Promise<CouncilOverview> {
	const now = opts.now ?? Math.floor(Date.now() / 1000)
	const today = Math.floor(now / DAY) * DAY
	const chartStart = today - (CHART_DAYS - 1) * DAY
	const { monthStart } = monthWindow(now * 1000)
	const chartActor = opts.scope === "me" ? opts.meId : null

	const [daily, month, split, current, previous, mine, quota] = await Promise.all([
		env.DB.prepare(
			`SELECT (e.created_at / ${DAY}) * ${DAY} AS day, e.kind, COUNT(*) AS n
			 FROM council_events e
			 WHERE ${DECIDED} AND e.created_at >= ? AND (?::int IS NULL OR e.actor_id = ?)
			 GROUP BY 1, 2`
		)
			.bind(DECISION_KINDS, chartStart, chartActor, chartActor)
			.all<{ day: number | string; kind: string; n: number | string }>(),
		env.DB.prepare(
			`SELECT e.kind, e.actor_id = ? AS mine, COUNT(*) AS n
			 FROM council_events e
			 WHERE ${DECIDED} AND e.created_at >= ?
			 GROUP BY 1, 2`
		)
			.bind(opts.meId, DECISION_KINDS, monthStart)
			.all<{ kind: string; mine: boolean; n: number | string }>(),
		env.DB.prepare(
			`SELECT e.source, COUNT(*) AS n FROM council_events e
			 WHERE ${DECIDED} AND e.created_at >= ? GROUP BY 1`
		)
			.bind(DECISION_KINDS, now - SPLIT_WINDOW)
			.all<{ source: string; n: number | string }>(),
		medianHours(env, now - MEDIAN_WINDOW, now, null),
		medianHours(env, now - 2 * MEDIAN_WINDOW, now - MEDIAN_WINDOW, null),
		medianHours(env, now - MEDIAN_WINDOW, now, opts.meId),
		getQuota(env, opts.meId),
	])

	const byDay = new Map<number, DayDecisions>()
	for (let i = 0; i < CHART_DAYS; i++) {
		const day = chartStart + i * DAY
		byDay.set(day, { day, sealed: 0, rejected: 0, editsReviewed: 0 })
	}
	for (const r of daily.results) {
		const bucket = byDay.get(Number(r.day))
		if (!bucket) continue
		if (r.kind === "seal") bucket.sealed += Number(r.n)
		else if (r.kind === "reject") bucket.rejected += Number(r.n)
		else bucket.editsReviewed += Number(r.n)
	}

	const count = (kinds: string[], mineOnly: boolean) =>
		month.results
			.filter((r) => kinds.includes(r.kind) && (!mineOnly || r.mine))
			.reduce((n, r) => n + Number(r.n), 0)
	const seals = count(["seal"], false)
	const rejects = count(["reject"], false)
	const splitOf = (source: string) => Number(split.results.find((r) => r.source === source)?.n ?? 0)

	return {
		decisionsByDay: [...byDay.values()],
		medianDecisionHours: { current, previous },
		sealRate: seals + rejects === 0 ? null : seals / (seals + rejects),
		sourceSplit: { web: splitOf("web"), discord: splitOf("discord") },
		me: {
			quota,
			rejectsThisMonth: count(["reject"], true),
			editsThisMonth: count(["edit_approve", "edit_reject"], true),
			medianDecisionHours: mine,
			bookmarkCap: config.council.bookmarkCap,
			bookmarkTtlSec: config.council.bookmarkTtlSec,
		},
	}
}

const WEEK = 7 * DAY
const ROSTER_WEEKS = 8

export interface RosterMember extends CouncilPerson {
	isYou: boolean
	isAdmin: boolean
	addedAt: number
	quota: BoostQuota
	sealsThisMonth: number
	rejectsThisMonth: number
	editsThisMonth: number
	lastActiveAt: number | null
	weekly: number[]
	lastWeek: { sealed: number; rejected: number; edits: number }
}

export async function getCouncilRoster(
	env: Env,
	opts: { meId: number; now?: number }
): Promise<RosterMember[]> {
	const now = opts.now ?? Math.floor(Date.now() / 1000)
	const { monthStart } = monthWindow(now * 1000)
	const weeksStart = now - ROSTER_WEEKS * WEEK
	const members = await env.DB.prepare(
		"SELECT user_id, added_at, is_admin FROM committee_members ORDER BY added_at ASC, user_id ASC"
	)
		.bind()
		.all<{ user_id: number | string; added_at: number | string; is_admin: boolean }>()
	const ids = members.results.map((m) => Number(m.user_id))
	if (ids.length === 0) return []

	const [people, tiers, month, weekly, lastActive, quotas] = await Promise.all([
		resolvePeople(env, ids),
		getCuratorTierMap(env),
		env.DB.prepare(
			`SELECT e.actor_id, e.kind, COUNT(*) AS n FROM council_events e
			 WHERE ${DECIDED} AND e.created_at >= ? AND e.actor_id = ANY(?)
			 GROUP BY 1, 2`
		)
			.bind(DECISION_KINDS, monthStart, ids)
			.all<{ actor_id: number | string; kind: string; n: number | string }>(),
		env.DB.prepare(
			`SELECT e.actor_id, ((e.created_at - ?) / ${WEEK}) AS week, e.kind, COUNT(*) AS n
			 FROM council_events e
			 WHERE ${DECIDED} AND e.created_at >= ? AND e.created_at < ? AND e.actor_id = ANY(?)
			 GROUP BY 1, 2, 3`
		)
			.bind(weeksStart, DECISION_KINDS, weeksStart, now, ids)
			.all<{
				actor_id: number | string
				week: number | string
				kind: string
				n: number | string
			}>(),
		env.DB.prepare(
			"SELECT actor_id, MAX(created_at) AS at FROM council_events WHERE actor_id = ANY(?) GROUP BY 1"
		)
			.bind(ids)
			.all<{ actor_id: number | string; at: number | string }>(),
		Promise.all(ids.map((id) => getQuota(env, id))),
	])

	return members.results.flatMap((m, i) => {
		const userId = Number(m.user_id)
		const person = people.get(userId)
		if (!person) return []
		const kinds = (list: string[]) =>
			month.results
				.filter((r) => Number(r.actor_id) === userId && list.includes(r.kind))
				.reduce((n, r) => n + Number(r.n), 0)
		const buckets = Array.from({ length: ROSTER_WEEKS }, () => 0)
		const lastWeek = { sealed: 0, rejected: 0, edits: 0 }
		for (const r of weekly.results) {
			if (Number(r.actor_id) !== userId) continue
			const week = Number(r.week)
			buckets[week] += Number(r.n)
			if (week !== ROSTER_WEEKS - 1) continue
			if (r.kind === "seal") lastWeek.sealed += Number(r.n)
			else if (r.kind === "reject") lastWeek.rejected += Number(r.n)
			else lastWeek.edits += Number(r.n)
		}
		const last = lastActive.results.find((r) => Number(r.actor_id) === userId)
		return [
			{
				...withTier(person, tiers),
				isYou: userId === opts.meId,
				isAdmin: m.is_admin,
				addedAt: Number(m.added_at),
				quota: quotas[i],
				sealsThisMonth: kinds(["seal"]),
				rejectsThisMonth: kinds(["reject"]),
				editsThisMonth: kinds(["edit_approve", "edit_reject"]),
				lastActiveAt: last ? Number(last.at) : null,
				weekly: buckets,
				lastWeek,
			},
		]
	})
}
