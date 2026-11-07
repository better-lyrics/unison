import { COMMUNITY_KEY_ID, config } from "@/config"
import {
	awardStrikePenaltyXp,
	revokeConfidenceXp,
	revokeStrikePenaltyXp,
} from "@/db/contribution-events"
import { recordCouncilEvent } from "@/db/council-events"
import { LOYAL_ONLY_EXPR_JOINED, RIVAL_DOWNVOTE_EXPR } from "@/db/predicates"
import { Logger } from "@/infra/logger"
import type { Env } from "@/types"

const log = new Logger("db")

export interface SuspectKey {
	userId: number
	submitterId: number
	votes: number
	ring: boolean
	serial: boolean
	lastVoteAt: number
}

export async function findSuspectKeys(
	env: Env,
	opts: { now?: number; all?: boolean } = {}
): Promise<SuspectKey[]> {
	const { freshSec, devotedShare, ring, serialMinVotes, serialWindowSec, lookbackSec } =
		config.voteIntegrity
	const now = opts.now ?? Math.floor(Date.now() / 1000)
	const baselineStart = now - ring.baselineSec
	const loadSince = opts.all ? 0 : Math.min(baselineStart, now - lookbackSec - ring.windowSec)
	const candidateSince = opts.all ? 0 : now - lookbackSec
	const res = await env.DB.prepare(`
		WITH active AS (
			SELECT DISTINCT user_id FROM votes WHERE vote = 1 AND created_at >= ?::int
		),
		counted AS (
			SELECT v.user_id, l.submitter_id AS sid, v.created_at
			FROM active a
			JOIN votes v ON v.user_id = a.user_id
			JOIN lyrics l ON l.id = v.lyrics_id
			JOIN users u ON u.id = v.user_id
			JOIN users s ON s.id = l.submitter_id
			WHERE v.is_self_vote = 0 AND v.vote = 1 AND u.banned_at IS NULL AND s.key_id <> ?
		),
		per_key AS (
			SELECT user_id, COUNT(*) AS total, MIN(created_at) AS first_vote,
				MAX(created_at) >= ?::int AS candidate
			FROM counted GROUP BY user_id
		),
		devoted AS (
			SELECT c.user_id, c.sid, COUNT(*) AS n, MIN(c.created_at) AS first_on_sid,
				MAX(c.created_at) AS last_vote, k.first_vote, k.candidate,
				(k.first_vote - u.created_at) < ? AS fresh
			FROM counted c
			JOIN per_key k ON k.user_id = c.user_id
			JOIN users u ON u.id = c.user_id
			GROUP BY c.user_id, c.sid, k.total, k.first_vote, k.candidate, u.created_at
			HAVING COUNT(*) >= ?::float8 * k.total
		),
		baseline AS (
			SELECT sid, COUNT(*) AS fresh_keys
			FROM devoted
			WHERE fresh AND first_on_sid >= ?::int AND first_on_sid < ?::int
			GROUP BY sid
		),
		rings AS (
			SELECT a.user_id, a.sid
			FROM devoted a
			JOIN devoted b ON b.sid = a.sid AND b.fresh AND ABS(b.first_vote - a.first_vote) <= ?
			LEFT JOIN baseline bl ON bl.sid = a.sid
			WHERE a.fresh AND a.candidate
			GROUP BY a.user_id, a.sid, bl.fresh_keys
			HAVING COUNT(*) >= GREATEST(?::int,
				CEIL(?::float8 * COALESCE(bl.fresh_keys, 0) * ?::int / ?::int))
		),
		bursts AS (
			SELECT user_id, sid, MAX(in_window) AS peak
			FROM (
				SELECT c.user_id, c.sid, COUNT(*) OVER (
					PARTITION BY c.user_id, c.sid ORDER BY c.created_at
					RANGE BETWEEN CURRENT ROW AND ?::int FOLLOWING
				) AS in_window
				FROM counted c
				JOIN devoted d ON d.user_id = c.user_id AND d.sid = c.sid
				WHERE d.fresh AND d.candidate
			) w
			GROUP BY user_id, sid
		)
		SELECT d.user_id, d.sid, d.n, d.last_vote, (r.user_id IS NOT NULL) AS ring,
			COALESCE(b.peak >= ?, FALSE) AS serial
		FROM devoted d
		JOIN users u ON u.id = d.user_id
		LEFT JOIN rings r ON r.user_id = d.user_id AND r.sid = d.sid
		LEFT JOIN bursts b ON b.user_id = d.user_id AND b.sid = d.sid
		WHERE d.candidate AND u.votes_discounted_at IS NULL AND u.vote_strike_id IS NULL
			AND (r.user_id IS NOT NULL OR b.peak >= ?)
	`)
		.bind(
			loadSince,
			COMMUNITY_KEY_ID,
			candidateSince,
			freshSec,
			devotedShare,
			baselineStart,
			now,
			ring.windowSec,
			ring.minKeys,
			ring.trafficFactor,
			ring.windowSec,
			ring.baselineSec,
			serialWindowSec,
			serialMinVotes,
			serialMinVotes
		)
		.all<{
			user_id: number
			sid: number
			n: number | string
			last_vote: number
			ring: boolean
			serial: boolean
		}>()
	return (res.results || []).map((r) => ({
		userId: r.user_id,
		submitterId: r.sid,
		votes: Number(r.n),
		ring: r.ring,
		serial: r.serial,
		lastVoteAt: r.last_vote,
	}))
}

export interface RivalVoter {
	userId: number
	votes: number
	lastVoteAt: number
}

export async function findRivalVoters(
	env: Env,
	opts: { now?: number; all?: boolean } = {}
): Promise<RivalVoter[]> {
	const { lookbackSec, rival } = config.voteIntegrity
	const now = opts.now ?? Math.floor(Date.now() / 1000)
	const since = opts.all ? 0 : now - lookbackSec
	const res = await env.DB.prepare(`
		WITH candidates AS (
			SELECT user_id FROM votes WHERE vote = -1 AND created_at >= ?::int
			UNION
			SELECT submitter_id FROM lyrics WHERE submitter_id IS NOT NULL AND created_at >= ?::int
		),
		marks AS (
			SELECT submitter_id, MAX(evidence_until) AS at FROM vote_strikes
			WHERE kind = 'rival' GROUP BY submitter_id
		),
		cast_votes AS (
			SELECT v.user_id, v.created_at, v.vote = -1 AND ${RIVAL_DOWNVOTE_EXPR} AS rival
			FROM candidates c
			JOIN votes v ON v.user_id = c.user_id AND v.is_self_vote = 0
			JOIN users u ON u.id = v.user_id
			LEFT JOIN marks m ON m.submitter_id = v.user_id
			WHERE u.banned_at IS NULL AND u.key_id <> ? AND v.created_at > COALESCE(m.at, -1)
		),
		tallies AS (
			SELECT user_id, COUNT(*) AS cast_count,
				COUNT(*) FILTER (WHERE rival) AS rival_votes,
				MAX(created_at) FILTER (WHERE rival) AS last_vote
			FROM cast_votes GROUP BY user_id
		)
		SELECT user_id, rival_votes, last_vote FROM tallies
		WHERE rival_votes >= ?::int AND rival_votes >= ?::float8 * cast_count
		ORDER BY user_id
	`)
		.bind(since, since, COMMUNITY_KEY_ID, rival.minVotes, rival.share)
		.all<{ user_id: number; rival_votes: number | string; last_vote: number }>()
	return res.results.map((r) => ({
		userId: r.user_id,
		votes: Number(r.rival_votes),
		lastVoteAt: r.last_vote,
	}))
}

export async function recordRivalStrikes(
	env: Env,
	voters: RivalVoter[],
	now = Math.floor(Date.now() / 1000)
): Promise<RecordedStrike[]> {
	const recorded: RecordedStrike[] = []
	for (const voter of voters) {
		try {
			const strike = await env.DB.transaction(async (tx) => {
				await tx.prepare("SELECT id FROM users WHERE id = ? FOR UPDATE").bind(voter.userId).run()
				return writeStrike(
					{ ...env, DB: tx },
					{
						submitterId: voter.userId,
						kind: "rival",
						keyCount: 0,
						voteCount: voter.votes,
						backfill: voter.lastVoteAt < config.voteIntegrity.rival.launchedAt,
						evidenceUntil: voter.lastVoteAt,
						now,
					}
				)
			})
			recorded.push({ ...strike, submitterId: voter.userId, keyIds: [] })
		} catch (err) {
			log.error("failed to record rival strike", { userId: voter.userId, error: String(err) })
		}
	}
	return recorded
}

type StrikeKind = "ring" | "serial" | "both" | "rival"

export interface RecordedStrike {
	strikeId: number
	submitterId: number
	created: boolean
	repeat: boolean
	keyIds: number[]
}

function kindOf(suspects: SuspectKey[]): StrikeKind {
	const ring = suspects.some((s) => s.ring)
	const serial = suspects.some((s) => s.serial)
	if (ring && serial) return "both"
	return ring ? "ring" : "serial"
}

const mergeKinds = (a: StrikeKind, b: StrikeKind): StrikeKind => (a === b ? a : "both")

export async function recordStrikes(
	env: Env,
	suspects: SuspectKey[],
	now = Math.floor(Date.now() / 1000)
): Promise<RecordedStrike[]> {
	const bySubmitter = new Map<number, SuspectKey[]>()
	for (const suspect of suspects) {
		const group = bySubmitter.get(suspect.submitterId)
		if (group) group.push(suspect)
		else bySubmitter.set(suspect.submitterId, [suspect])
	}
	const recorded: RecordedStrike[] = []
	for (const [submitterId, group] of bySubmitter) {
		try {
			const strike = await env.DB.transaction((tx) =>
				recordSubmitterStrike({ ...env, DB: tx }, submitterId, group, now)
			)
			if (strike) recorded.push(strike)
		} catch (err) {
			log.error("failed to record vote strike", { submitterId, error: String(err) })
		}
	}
	return recorded
}

interface StrikeWrite {
	submitterId: number
	kind: StrikeKind
	keyCount: number
	voteCount: number
	backfill: boolean
	evidenceUntil: number | null
	now: number
}

type WrittenStrike = Omit<RecordedStrike, "submitterId" | "keyIds">

async function writeStrike(txEnv: Env, w: StrikeWrite): Promise<WrittenStrike> {
	const tx = txEnv.DB
	const rival = w.kind === "rival"
	const mergeable = await tx
		.prepare(
			`SELECT id, kind, repeat FROM vote_strikes
			WHERE submitter_id = ? AND undone_at IS NULL AND NOT backfill AND (kind = 'rival') = ?
				AND detected_at >= ?::int
			ORDER BY detected_at DESC, id DESC LIMIT 1`
		)
		.bind(w.submitterId, rival, w.now - config.voteIntegrity.mergeWindowSec)
		.first<{ id: number; kind: StrikeKind; repeat: boolean }>()
	if (mergeable) {
		await tx
			.prepare(
				`UPDATE vote_strikes SET key_count = key_count + ?, vote_count = vote_count + ?, kind = ?,
					evidence_until = GREATEST(evidence_until, ?::int), settled_at = NULL
				WHERE id = ?`
			)
			.bind(
				w.keyCount,
				w.voteCount,
				mergeKinds(mergeable.kind, w.kind),
				w.evidenceUntil,
				mergeable.id
			)
			.run()
		return { strikeId: mergeable.id, created: false, repeat: mergeable.repeat }
	}

	const earlier = await tx
		.prepare(
			"SELECT 1 FROM vote_strikes WHERE submitter_id = ? AND undone_at IS NULL AND NOT backfill LIMIT 1"
		)
		.bind(w.submitterId)
		.first()
	const repeat = !w.backfill && earlier !== null
	const inserted = await tx
		.prepare(
			`INSERT INTO vote_strikes (submitter_id, kind, detected_at, key_count, vote_count, repeat, backfill,
				evidence_until)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?::int) RETURNING id`
		)
		.bind(
			w.submitterId,
			w.kind,
			w.now,
			w.keyCount,
			w.voteCount,
			repeat,
			w.backfill,
			w.evidenceUntil
		)
		.first<{ id: number }>()
	if (!inserted) throw new Error(`vote strike insert returned no row for ${w.submitterId}`)
	if (repeat) await awardStrikePenaltyXp(txEnv, w.submitterId, inserted.id)
	await recordCouncilEvent(tx, {
		actorId: null,
		kind: "vote_strike",
		source: "system",
		subjectUserId: w.submitterId,
		refId: inserted.id,
		note: strikeNote({ ...w, repeat }),
		at: w.now,
	})
	return { strikeId: inserted.id, created: true, repeat }
}

async function recordSubmitterStrike(
	txEnv: Env,
	submitterId: number,
	suspects: SuspectKey[],
	now: number
): Promise<RecordedStrike | null> {
	const tx = txEnv.DB
	await tx.prepare("SELECT id FROM users WHERE id = ? FOR UPDATE").bind(submitterId).run()
	const undiscounted = await tx
		.prepare(
			"SELECT id FROM users WHERE id = ANY(?::int[]) AND votes_discounted_at IS NULL FOR UPDATE"
		)
		.bind(suspects.map((s) => s.userId))
		.all<{ id: number }>()
	const open = new Set(undiscounted.results.map((r) => r.id))
	const keys = suspects.filter((s) => open.has(s.userId))
	if (keys.length === 0) return null

	const keyIds = keys.map((k) => k.userId)
	const lastVoteAt = keys.reduce((max, k) => Math.max(max, k.lastVoteAt), 0)
	const strike = await writeStrike(txEnv, {
		submitterId,
		kind: kindOf(keys),
		keyCount: keys.length,
		voteCount: keys.reduce((sum, k) => sum + k.votes, 0),
		backfill: lastVoteAt < config.voteIntegrity.launchedAt,
		evidenceUntil: null,
		now,
	})

	await tx
		.prepare(
			`UPDATE users SET votes_discounted_at = ?, vote_strike_id = ?
			WHERE id = ANY(?::int[]) AND votes_discounted_at IS NULL`
		)
		.bind(now, strike.strikeId, keyIds)
		.run()
	return { ...strike, submitterId, keyIds }
}

export async function revokeStrikeXp(env: Env, strikeId: number): Promise<number> {
	return env.DB.transaction(async (tx) => {
		const strike = await tx
			.prepare(
				"SELECT submitter_id FROM vote_strikes WHERE id = ? AND undone_at IS NULL FOR UPDATE"
			)
			.bind(strikeId)
			.first<{ submitter_id: number }>()
		if (!strike) return 0
		const targets = await tx
			.prepare(
				`SELECT DISTINCT l.id
				FROM users u
				JOIN votes v ON v.user_id = u.id
				JOIN lyrics l ON l.id = v.lyrics_id
				WHERE u.vote_strike_id = ? AND l.submitter_id = ? AND l.deleted_at IS NULL`
			)
			.bind(strikeId, strike.submitter_id)
			.all<{ id: number }>()
		const xp = await revokeConfidenceXp(
			{ ...env, DB: tx },
			strike.submitter_id,
			targets.results.map((r) => r.id)
		)
		if (xp !== 0) {
			await tx
				.prepare("UPDATE vote_strikes SET xp_revoked = xp_revoked + ? WHERE id = ?")
				.bind(xp, strikeId)
				.run()
		}
		return xp
	})
}

export interface UnsettledStrike {
	id: number
	submitterId: number
	submitterKeyId: string
	repeat: boolean
	keyCount: number
	keyIds: number[]
}

export async function unsettledStrikes(env: Env): Promise<UnsettledStrike[]> {
	const res = await env.DB.prepare(
		`SELECT s.id, s.submitter_id, sub.key_id, s.repeat, s.key_count,
			ARRAY(SELECT u.id FROM users u WHERE u.vote_strike_id = s.id ORDER BY u.id) AS key_ids
		FROM vote_strikes s
		JOIN users sub ON sub.id = s.submitter_id
		WHERE s.settled_at IS NULL AND s.undone_at IS NULL
		ORDER BY s.id`
	).all<{
		id: number
		submitter_id: number
		key_id: string
		repeat: boolean
		key_count: number
		key_ids: number[]
	}>()
	return res.results.map((r) => ({
		id: r.id,
		submitterId: r.submitter_id,
		submitterKeyId: r.key_id,
		repeat: r.repeat,
		keyCount: r.key_count,
		keyIds: r.key_ids,
	}))
}

export async function markStrikeSettled(
	env: Env,
	strike: Pick<UnsettledStrike, "id" | "keyCount">,
	now: number
): Promise<void> {
	await env.DB.prepare(
		"UPDATE vote_strikes SET settled_at = ? WHERE id = ? AND key_count = ? AND undone_at IS NULL"
	)
		.bind(now, strike.id, strike.keyCount)
		.run()
}

export type UndoStrikeResult = "undone" | "not_found" | "already_undone"

export interface UndoneStrike {
	result: UndoStrikeResult
	keyIds: number[]
	submitterId: number | null
	submitterKeyId: string | null
	repeatChanged: boolean
}

export async function undoStrike(
	env: Env,
	strikeId: number,
	actorId: number,
	now = Math.floor(Date.now() / 1000)
): Promise<UndoneStrike> {
	const unchanged = (result: UndoStrikeResult): UndoneStrike => ({
		result,
		keyIds: [],
		submitterId: null,
		submitterKeyId: null,
		repeatChanged: false,
	})
	return env.DB.transaction(async (tx) => {
		const submitter = await tx
			.prepare(
				`SELECT u.id, u.key_id FROM vote_strikes s JOIN users u ON u.id = s.submitter_id
				WHERE s.id = ? FOR UPDATE OF u`
			)
			.bind(strikeId)
			.first<{ id: number; key_id: string }>()
		if (!submitter) return unchanged("not_found")
		const strike = await tx
			.prepare("SELECT detected_at, repeat, undone_at FROM vote_strikes WHERE id = ? FOR UPDATE")
			.bind(strikeId)
			.first<{ detected_at: number; repeat: boolean; undone_at: number | null }>()
		if (!strike) return unchanged("not_found")
		if (strike.undone_at !== null) return unchanged("already_undone")

		await tx
			.prepare("UPDATE vote_strikes SET undone_at = ?, undone_by = ? WHERE id = ?")
			.bind(now, actorId, strikeId)
			.run()
		const keys = await tx
			.prepare("UPDATE users SET votes_discounted_at = NULL WHERE vote_strike_id = ? RETURNING id")
			.bind(strikeId)
			.all<{ id: number }>()
		const txEnv = { ...env, DB: tx }
		await revokeStrikePenaltyXp(txEnv, strikeId)
		const lifted = await liftLaterRepeats(txEnv, submitter.id, strikeId, strike.detected_at)
		await recordCouncilEvent(tx, {
			actorId,
			kind: "vote_strike_undo",
			source: "web",
			subjectUserId: submitter.id,
			refId: strikeId,
			note: null,
			at: now,
		})
		return {
			result: "undone",
			keyIds: keys.results.map((k) => k.id).sort((a, b) => a - b),
			submitterId: submitter.id,
			submitterKeyId: submitter.key_id,
			repeatChanged: strike.repeat || lifted > 0,
		}
	})
}

async function liftLaterRepeats(
	txEnv: Env,
	submitterId: number,
	undoneId: number,
	undoneAt: number
): Promise<number> {
	const live = await txEnv.DB.prepare(
		`SELECT id, detected_at, repeat, backfill FROM vote_strikes
		WHERE submitter_id = ? AND undone_at IS NULL
		ORDER BY detected_at, id FOR UPDATE`
	)
		.bind(submitterId)
		.all<{ id: number; detected_at: number; repeat: boolean; backfill: boolean }>()
	let earlierLive = false
	let lifted = 0
	for (const s of live.results) {
		const later = s.detected_at > undoneAt || (s.detected_at === undoneAt && s.id > undoneId)
		if (later && s.repeat && !earlierLive) {
			await txEnv.DB.prepare("UPDATE vote_strikes SET repeat = FALSE WHERE id = ?").bind(s.id).run()
			await revokeStrikePenaltyXp(txEnv, s.id)
			lifted++
		}
		if (!s.backfill) earlierLive = true
	}
	return lifted
}

export async function votersOn(env: Env, lyricsIds: number[]): Promise<number[]> {
	if (lyricsIds.length === 0) return []
	const res = await env.DB.prepare(
		"SELECT DISTINCT user_id FROM votes WHERE lyrics_id = ANY(?::int[]) ORDER BY user_id"
	)
		.bind(lyricsIds)
		.all<{ user_id: number }>()
	return res.results.map((r) => r.user_id)
}

export async function lyricsVotedByKeys(env: Env, keyIds: number[]): Promise<number[]> {
	if (keyIds.length === 0) return []
	const res = await env.DB.prepare(
		`SELECT DISTINCT l.id FROM votes v
		JOIN lyrics l ON l.id = v.lyrics_id
		WHERE v.user_id = ANY(?::int[]) AND l.deleted_at IS NULL
		ORDER BY l.id`
	)
		.bind(keyIds)
		.all<{ id: number }>()
	return res.results.map((r) => r.id)
}

export interface StaleLoyalLyric {
	id: number
	submitterId: number | null
}

export async function staleLoyalLyrics(env: Env): Promise<StaleLoyalLyric[]> {
	const res = await env.DB.prepare(
		`SELECT l.id, l.submitter_id FROM lyrics l
		WHERE l.deleted_at IS NULL
			AND (l.upvotes > 0 OR l.loyal_only)
			AND (
				l.loyal_only IS DISTINCT FROM ${LOYAL_ONLY_EXPR_JOINED}
				OR (l.loyal_only AND EXISTS (
					SELECT 1 FROM contribution_events e
					WHERE e.ref_type = 'lyric' AND e.ref_id = l.id AND e.user_id = l.submitter_id
						AND e.kind IN ('reached-medium', 'reached-high', 'first-for-song')
				))
			)
		ORDER BY l.id`
	).all<{ id: number; submitter_id: number | null }>()
	return res.results.map((r) => ({ id: r.id, submitterId: r.submitter_id }))
}

export interface StrikeSummary {
	kind: string
	keyCount: number
	voteCount: number
	repeat: boolean
	backfill: boolean
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`

export function strikeNote(s: StrikeSummary): string {
	const base =
		s.kind === "rival"
			? `rival: ${count(s.voteCount, "vote")}`
			: `${s.kind}: ${count(s.keyCount, "key")}, ${count(s.voteCount, "vote")}`
	if (s.repeat) return `${base} (repeat)`
	return s.backfill ? `${base} (history before launch)` : base
}

export async function hasAnyStrike(env: Env): Promise<boolean> {
	return (await env.DB.prepare("SELECT 1 FROM vote_strikes LIMIT 1").first()) !== null
}

export async function hasRivalStrike(env: Env): Promise<boolean> {
	return (
		(await env.DB.prepare("SELECT 1 FROM vote_strikes WHERE kind = 'rival' LIMIT 1").first()) !==
		null
	)
}
