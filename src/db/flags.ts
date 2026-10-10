import { config } from "@/config"
import { isCommittee } from "@/db/committee"
import { type CouncilSource, recordCouncilEvent } from "@/db/council-events"
import { softDeleteLyrics } from "@/db/lyrics"
import { NOW_EPOCH } from "@/db/predicates"
import { closeCase, insertOpenCase, lockLyricCases } from "@/db/report-cases"
import type { Env } from "@/types"

const { reportHide } = config.moderation

const qualifyingReports = (asOf: string) => `JOIN users u ON u.id = r.user_id
	WHERE r.reason IN (${reportHide.reasons.map(() => "?").join(", ")})
		AND u.reputation >= ? AND u.vote_count >= ? AND u.banned_at IS NULL
		AND r.created_at > COALESCE(
			(SELECT MAX(kept.decided_at) FROM report_cases kept
				WHERE kept.lyrics_id = r.lyrics_id AND kept.status = 'kept' AND kept.decided_at <= ${asOf}),
			0
		)`

const QUALIFYING_PARAMS = [
	...reportHide.reasons,
	reportHide.minReporterReputation,
	reportHide.minReporterVotes,
]

const CONFLICT_EXPR = `CASE
	WHEN l.submitter_id = ? THEN 'submitter'
	WHEN EXISTS (SELECT 1 FROM reports cr WHERE cr.lyrics_id = l.id AND cr.user_id = ?) THEN 'reporter'
END`

const conflictParams = (userId: number | null) => [userId, userId]

export type FlagReason = (typeof reportHide.reasons)[number]

export type FlagConflict = "submitter" | "reporter" | null

export interface FlagReport {
	id: number
	reason: FlagReason
	details: string | null
	reporterId: number
	createdAt: number
}

export interface OpenFlag {
	id: number
	lyricsId: number
	videoId: string
	song: string
	artist: string
	submitterId: number | null
	openedAt: number
	reports: FlagReport[]
	removerIds: number[]
	keeperIds: number[]
	conflict: FlagConflict
}

export interface RecentFlag extends OpenFlag {
	status: "open" | "removed" | "kept"
	decidedAt: number | null
}

export interface FlagTally {
	removals: number
	keeps: number
}

export type FlagVoteResult =
	| ({ ok: true; status: "open" } & FlagTally)
	| ({ ok: true; status: "removed"; lyricsId: number } & FlagTally)
	| ({ ok: true; status: "kept"; lyricsId: number } & FlagTally)
	| { ok: false; reason: "not_committee" | "not_found" | "already_decided" | "conflict" }

export function openCaseIfQualified(env: Env, lyricsId: number): Promise<number | null> {
	return env.DB.transaction(async (tx) => {
		await lockLyricCases(tx, lyricsId)
		const count = await tx
			.prepare(
				`SELECT COUNT(*)::INTEGER AS n FROM reports r ${qualifyingReports(NOW_EPOCH)}
					AND r.lyrics_id = ?
					AND EXISTS (SELECT 1 FROM lyrics l WHERE l.id = r.lyrics_id AND l.deleted_at IS NULL)`
			)
			.bind(...QUALIFYING_PARAMS, lyricsId)
			.first<{ n: number }>()
		if ((count?.n ?? 0) < reportHide.threshold) return null
		return insertOpenCase(tx, lyricsId)
	})
}

export async function castFlagVote(
	env: Env,
	caseId: number,
	voterId: number,
	remove: boolean,
	note: string | null,
	source: CouncilSource
): Promise<FlagVoteResult> {
	if (!(await isCommittee(env, voterId))) return { ok: false, reason: "not_committee" }
	return env.DB.transaction(async (tx): Promise<FlagVoteResult> => {
		const target = await tx
			.prepare("SELECT lyrics_id FROM report_cases WHERE id = ?")
			.bind(caseId)
			.first<{ lyrics_id: number }>()
		if (!target) return { ok: false, reason: "not_found" }
		await lockLyricCases(tx, Number(target.lyrics_id))

		const flag = await tx
			.prepare(
				`SELECT c.id, c.lyrics_id, c.status, ${CONFLICT_EXPR} AS conflict
					FROM report_cases c JOIN lyrics l ON l.id = c.lyrics_id
					WHERE c.id = ? FOR UPDATE OF c`
			)
			.bind(...conflictParams(voterId), caseId)
			.first<{ id: number; lyrics_id: number; status: string; conflict: FlagConflict }>()
		if (!flag) return { ok: false, reason: "not_found" }
		if (flag.status !== "open") return { ok: false, reason: "already_decided" }
		const lyricsId = Number(flag.lyrics_id)

		if (flag.conflict) return { ok: false, reason: "conflict" }

		const changed = await tx
			.prepare(
				`INSERT INTO report_case_votes (case_id, voter_id, remove, note) VALUES (?, ?, ?, ?)
					ON CONFLICT (case_id, voter_id) DO UPDATE SET remove = EXCLUDED.remove, note = EXCLUDED.note
					WHERE report_case_votes.remove IS DISTINCT FROM EXCLUDED.remove
					RETURNING voter_id`
			)
			.bind(caseId, voterId, remove, note)
			.first<{ voter_id: number }>()
		if (changed) {
			await recordCouncilEvent(tx, {
				actorId: voterId,
				kind: remove ? "flag_remove" : "flag_keep",
				source,
				lyricsId,
				refId: caseId,
				note,
			})
		}

		const counts = await tx
			.prepare(
				`SELECT COUNT(*) FILTER (WHERE remove)::INTEGER AS removals,
						COUNT(*) FILTER (WHERE NOT remove)::INTEGER AS keeps
					FROM report_case_votes WHERE case_id = ?`
			)
			.bind(caseId)
			.first<FlagTally>()
		const tally = { removals: counts?.removals ?? 0, keeps: counts?.keeps ?? 0 }

		if (!remove) {
			await closeCase(tx, caseId, "kept")
			return { ok: true, status: "kept", lyricsId, ...tally }
		}

		if (tally.removals < config.council.reportFlags.removals)
			return { ok: true, status: "open", ...tally }

		await closeCase(tx, caseId, "removed")
		await softDeleteLyrics({ ...env, DB: tx }, lyricsId, voterId, "admin", "council flag: removed")
		return { ok: true, status: "removed", lyricsId, ...tally }
	})
}

interface FlagRow {
	id: number
	lyrics_id: number
	video_id: string
	song: string
	artist: string
	submitter_id: number | null
	opened_at: number
	status: "open" | "removed" | "kept"
	decided_at: number | null
	reports: {
		id: number
		reason: FlagReason
		details: string | null
		reporterId: number
		createdAt: number
	}[]
	remover_ids: number[]
	keeper_ids: number[]
	conflict: FlagConflict
}

async function listFlags(
	env: Env,
	viewerId: number | null,
	where: string,
	params: unknown[]
): Promise<RecentFlag[]> {
	const rows = await env.DB.prepare(
		`SELECT c.id, c.lyrics_id, l.video_id, l.song, l.artist, l.submitter_id,
				c.opened_at, c.status, c.decided_at,
				COALESCE((
					SELECT json_agg(json_build_object(
						'id', r.id, 'reason', r.reason, 'details', r.details,
						'reporterId', r.user_id, 'createdAt', r.created_at
					) ORDER BY r.created_at, r.id)
					FROM reports r ${qualifyingReports("c.opened_at")}
						AND r.lyrics_id = c.lyrics_id
						AND r.created_at <= COALESCE(c.decided_at, r.created_at)
				), '[]') AS reports,
				COALESCE(
					ARRAY_AGG(v.voter_id ORDER BY v.created_at, v.voter_id) FILTER (WHERE v.remove),
					'{}'
				) AS remover_ids,
				COALESCE(
					ARRAY_AGG(v.voter_id ORDER BY v.created_at, v.voter_id) FILTER (WHERE NOT v.remove),
					'{}'
				) AS keeper_ids,
				${CONFLICT_EXPR} AS conflict
			FROM report_cases c
			JOIN lyrics l ON l.id = c.lyrics_id
			LEFT JOIN report_case_votes v ON v.case_id = c.id
			WHERE (${where}) AND NOT (c.status = 'open' AND l.deleted_at IS NOT NULL)
			GROUP BY c.id, l.id
			ORDER BY c.opened_at ASC, c.id ASC`
	)
		.bind(...QUALIFYING_PARAMS, ...conflictParams(viewerId), ...params)
		.all<FlagRow>()
	return rows.results.map((r) => ({
		id: Number(r.id),
		lyricsId: Number(r.lyrics_id),
		videoId: r.video_id,
		song: r.song,
		artist: r.artist,
		submitterId: r.submitter_id === null ? null : Number(r.submitter_id),
		openedAt: Number(r.opened_at),
		status: r.status,
		decidedAt: r.decided_at === null ? null : Number(r.decided_at),
		reports: r.reports.map((report) => ({
			id: Number(report.id),
			reason: report.reason,
			details: report.details,
			reporterId: Number(report.reporterId),
			createdAt: Number(report.createdAt),
		})),
		removerIds: r.remover_ids.map(Number),
		keeperIds: r.keeper_ids.map(Number),
		conflict: r.conflict,
	}))
}

export async function listOpenFlags(env: Env, viewerId: number | null): Promise<OpenFlag[]> {
	const flags = await listFlags(env, viewerId, "c.status = 'open'", [])
	return flags.map(({ status: _status, decidedAt: _decidedAt, ...flag }) => flag)
}

export function listRecentFlags(env: Env, sinceSec: number): Promise<RecentFlag[]> {
	return listFlags(env, null, "c.status = 'open' OR c.decided_at >= ?", [sinceSec])
}
