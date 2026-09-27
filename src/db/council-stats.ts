import { type BoostQuota, getQuota, monthWindow } from "@/db/boost"
import { DECISION_KINDS, UNDONE_EXPR } from "@/db/council-events"
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
		},
	}
}
