import { config } from "@/config"
import { isCommittee } from "@/db/committee"
import {
	type LyricRevisionState,
	type RevisionRow,
	countRecentRevisions,
	ensureBaseRevision,
	getPendingRevisionRow,
	getPreviouslyLiveRow,
	getRevisionRow,
	getRevisionSummary,
	insertRevision,
	listPendingRevisionRows,
	listRevisionSummaries,
	loadLyricState,
	recordReview,
	retireLiveRevision,
	revisionAuthor,
	setAnchorRevision,
	setCurrentRevision,
	setRevisionStatus,
	supersedePending,
} from "@/db/lyric-revisions"
import { invalidateCacheForLyric } from "@/db/lyrics"
import type { D1Compat } from "@/infra/database"
import { Logger } from "@/infra/logger"
import { type JevVerdict, disabledJevGate, runJevStep } from "@/services/jev-gate"
import type {
	Env,
	FieldCheck,
	GateOutcome,
	LyricsFormat,
	PendingRevisionCard,
	PreviewResult,
	RevisionDetail,
	RevisionDiff,
	RevisionRateLimit,
	RevisionSummary,
} from "@/types"
import { decompressIfNeeded } from "@/utils/compression"
import { detectLanguage } from "@/utils/detect-language"
import { ErrorCode, buildError } from "@/utils/errors"
import { type LyricLine, extractLines } from "@/utils/extract-text"
import { sha256Hex } from "@/utils/hash"
import { normalizeIsrc } from "@/utils/isrc"
import { buildDiffRows, diffPreview, renderLinesForDiff, unifiedDiff } from "@/utils/lyric-diff"
import { type DriftResult, measureDrift } from "@/utils/lyric-drift"
import { decideOutcome } from "@/utils/revision-gate"
import { type ContentValidation, validateLyricContent } from "@/utils/validate-lyrics"

const log = new Logger("revisions")

export interface RevisionInput {
	lyrics: string
	format: LyricsFormat
	language?: string | null
	isrc?: string | null
}

interface RevertSource {
	revisionId: number
	language: string | null
	isrc: string | null
}

interface Candidate {
	content: string
	format: LyricsFormat
	syncType: RevisionRow["sync_type"]
	language: string | null
	isrc: string | null
}

interface Assessment {
	lyric: LyricRevisionState
	checks: FieldCheck[]
	failure: { code: ErrorCode; hint?: string } | null
	candidate: Candidate | null
	noChanges: boolean
	drift: DriftResult
	jevProbability: number | null
	outcome: GateOutcome
	rateLimit: RevisionRateLimit
	anchorLines: LyricLine[]
	candidateLines: LyricLine[]
}

type AccessFailure = { ok: false; reason: "not_found" | "not_owner" }

export type SaveResult =
	| { ok: true; revision: RevisionSummary }
	| AccessFailure
	| { ok: false; reason: "rate_limited" | "no_changes" }
	| { ok: false; reason: "invalid"; code: ErrorCode; hint?: string }

export type DecisionResult =
	| { ok: true; revision: RevisionSummary }
	| { ok: false; reason: "not_committee" | "not_found" | "already_decided" | "stale" }

const NO_DRIFT: DriftResult = { text: 0, timing: 0, timingOffsetMs: 0 }
const NOT_CHECKED: JevVerdict = { flagged: false, probability: null }
const NOT_SAVABLE: GateOutcome = { goesLive: false, reason: null }
const LANGUAGE_HINT = "Pick a language from the list."
const ISRC_HINT = "An ISRC looks like USRC17607839."

async function revisionLines(stored: string, format: LyricsFormat): Promise<LyricLine[]> {
	try {
		return extractLines(await decompressIfNeeded(stored), format)
	} catch (err) {
		log.warn("stored revision content could not be parsed", { error: (err as Error).message })
		return []
	}
}

const joinText = (lines: LyricLine[]): string => lines.map((line) => line.text).join("\n")

function resolveLanguage(
	requested: string | null | undefined,
	current: string | null,
	revert: RevertSource | null
): { value: string | null; valid: boolean } {
	if (requested === undefined) return { value: current, valid: true }
	const value = requested?.trim() || null
	if (value === null || value === current || value === revert?.language) {
		return { value, valid: true }
	}
	return { value, valid: config.revisions.languages.has(value) }
}

function resolveIsrc(
	requested: string | null | undefined,
	current: string | null,
	revert: RevertSource | null
): { value: string | null; valid: boolean } {
	if (requested === undefined) return { value: current, valid: true }
	const raw = requested?.trim() || null
	if (raw === null || raw === current || raw === revert?.isrc) return { value: raw, valid: true }
	const normalized = normalizeIsrc(raw)
	return normalized ? { value: normalized, valid: true } : { value: raw, valid: false }
}

async function languageCheck(
	language: { value: string | null; valid: boolean },
	plainText: string | null
): Promise<FieldCheck> {
	if (!language.valid) {
		return { field: "language", status: "bad", message: LANGUAGE_HINT }
	}
	if (language.value === null) {
		return { field: "language", status: "ok", message: "No language set." }
	}
	if (plainText) {
		const detected = await detectLanguage(plainText)
		const base = (code: string) => code.split("-")[0].toLowerCase()
		if (detected.language && base(detected.language) !== base(language.value)) {
			return {
				field: "language",
				status: "warn",
				message: `The lyrics look like ${detected.language}, not ${language.value}.`,
			}
		}
	}
	return { field: "language", status: "ok", message: `Language: ${language.value}.` }
}

function isrcCheck(isrc: { value: string | null; valid: boolean }): FieldCheck {
	if (!isrc.valid) {
		return { field: "isrc", status: "bad", message: ISRC_HINT }
	}
	return {
		field: "isrc",
		status: "ok",
		message: isrc.value ? `ISRC: ${isrc.value}.` : "No ISRC set.",
	}
}

function firstFailure(
	validated: ContentValidation,
	language: { valid: boolean },
	isrc: { valid: boolean }
): Assessment["failure"] {
	if (!validated.ok) return { code: validated.code, hint: validated.hint }
	if (!language.valid) return { code: ErrorCode.INVALID_PAYLOAD, hint: LANGUAGE_HINT }
	if (!isrc.valid) return { code: ErrorCode.INVALID_PAYLOAD, hint: ISRC_HINT }
	return null
}

async function remainingEdits(
	db: D1Compat,
	lyricsId: number,
	userId: number
): Promise<RevisionRateLimit> {
	const since = Math.floor(Date.now() / 1000) - config.revisions.windowSeconds
	const used = await countRecentRevisions(db, lyricsId, userId, since)
	const lyricLimit = config.revisions.perLyricPerWindow
	const userLimit = config.revisions.perUserPerWindow
	return {
		lyricRemaining: Math.max(0, lyricLimit - used.lyric),
		lyricLimit,
		userRemaining: Math.max(0, userLimit - used.user),
		userLimit,
	}
}

async function assess(
	db: D1Compat,
	lyricsId: number,
	userId: number,
	input: RevisionInput,
	lock: boolean,
	revert: RevertSource | null,
	jev: JevVerdict
): Promise<{ ok: true; assessment: Assessment } | AccessFailure> {
	const initial = await loadLyricState(db, lyricsId, lock)
	if (!initial || initial.deleted_at !== null) return { ok: false, reason: "not_found" }
	if (initial.submitter_id !== userId) return { ok: false, reason: "not_owner" }
	if (initial.current_revision_id === null) await ensureBaseRevision(db, lyricsId)
	const lyric =
		initial.current_revision_id === null ? await loadLyricState(db, lyricsId, false) : initial
	if (!lyric?.current_revision_id || !lyric.anchor_revision_id) {
		return { ok: false, reason: "not_found" }
	}

	const live = await getRevisionRow(db, lyricsId, lyric.current_revision_id)
	const anchor = await getRevisionRow(db, lyricsId, lyric.anchor_revision_id)
	if (!live || !anchor) return { ok: false, reason: "not_found" }

	const rateLimit = await remainingEdits(db, lyricsId, userId)
	const validated = validateLyricContent(input.lyrics, input.format)
	const language = resolveLanguage(input.language, live.language, revert)
	const isrc = resolveIsrc(input.isrc, live.isrc, revert)

	const lines = validated.ok ? extractLines(input.lyrics, validated.format) : null
	const checks: FieldCheck[] = [
		validated.ok
			? {
					field: "lyrics",
					status: "ok",
					message: `${validated.format.toUpperCase()}, ${validated.syncType}, ${lines?.length ?? 0} lines.`,
				}
			: {
					field: "lyrics",
					status: "bad",
					message: buildError(validated.code, validated.hint ? { hint: validated.hint } : undefined)
						.hint,
				},
		await languageCheck(language, lines ? joinText(lines) : null),
		isrcCheck(isrc),
	]

	const failure = firstFailure(validated, language, isrc)

	if (!validated.ok || !lines || failure) {
		return {
			ok: true,
			assessment: {
				lyric,
				checks,
				failure,
				candidate: null,
				noChanges: false,
				drift: NO_DRIFT,
				jevProbability: null,
				outcome: NOT_SAVABLE,
				rateLimit,
				anchorLines: [],
				candidateLines: [],
			},
		}
	}

	const candidate: Candidate = {
		content: input.lyrics,
		format: validated.format,
		syncType: validated.syncType,
		language: language.value,
		isrc: isrc.value,
	}
	const noChanges =
		sha256Hex(candidate.content) === live.content_hash &&
		candidate.language === live.language &&
		candidate.isrc === live.isrc

	const anchorLines = await revisionLines(anchor.lyrics, anchor.format)
	const drift = measureDrift(anchorLines, lines)
	const outcome = decideOutcome({
		sealed: lyric.committee_approved_at !== null,
		jevFlagged: jev.flagged,
		textDrift: drift.text,
		timingDrift: drift.timing,
	})

	return {
		ok: true,
		assessment: {
			lyric,
			checks,
			failure: null,
			candidate,
			noChanges,
			drift,
			jevProbability: jev.probability,
			outcome,
			rateLimit,
			anchorLines,
			candidateLines: lines,
		},
	}
}

export async function previewRevision(
	env: Env,
	lyricsId: number,
	userId: number,
	input: RevisionInput
): Promise<{ ok: true; preview: PreviewResult } | AccessFailure> {
	const result = await assess(env.DB, lyricsId, userId, input, false, null, NOT_CHECKED)
	if (!result.ok) return result
	const a = result.assessment
	return {
		ok: true,
		preview: {
			checks: a.checks,
			drift: {
				text: a.drift.text,
				timing: a.drift.timing,
				timingOffsetMs: a.drift.timingOffsetMs,
				textLimit: config.revisions.textDriftLimit,
				timingLimit: config.revisions.timingDriftLimit,
			},
			outcome: a.outcome,
			noChanges: a.noChanges,
			rateLimit: a.rateLimit,
		},
	}
}

const hasRoom = (limit: RevisionRateLimit): boolean =>
	limit.lyricRemaining > 0 && limit.userRemaining > 0

// Runs before the row lock so a slow TypeSafe call never holds it.
async function checkWithJev(
	env: Env,
	lyricsId: number,
	userId: number,
	input: RevisionInput,
	revert: RevertSource | null
): Promise<JevVerdict> {
	const gate = env.JEV ?? disabledJevGate
	if (gate === disabledJevGate) return NOT_CHECKED
	const result = await assess(env.DB, lyricsId, userId, input, false, revert, NOT_CHECKED)
	if (!result.ok) return NOT_CHECKED
	const a = result.assessment
	if (a.noChanges || !a.candidate || !a.outcome.goesLive || !hasRoom(a.rateLimit)) {
		return NOT_CHECKED
	}
	if (renderLinesForDiff(a.anchorLines) === renderLinesForDiff(a.candidateLines)) {
		return NOT_CHECKED
	}
	return runJevStep(gate, {
		lyricsId,
		song: a.lyric.song,
		artist: a.lyric.artist,
		diff: unifiedDiff(a.anchorLines, a.candidateLines, { before: "anchor", after: "edit" }),
	})
}

async function commitRevision(
	env: Env,
	lyricsId: number,
	userId: number,
	input: RevisionInput,
	revert: RevertSource | null
): Promise<SaveResult> {
	const jev = await checkWithJev(env, lyricsId, userId, input, revert)
	const result = await env.DB.transaction(async (tx): Promise<SaveResult> => {
		const assessed = await assess(tx, lyricsId, userId, input, true, revert, jev)
		if (!assessed.ok) return assessed
		const a = assessed.assessment
		if (!hasRoom(a.rateLimit)) {
			return { ok: false, reason: "rate_limited" }
		}
		if (a.failure || !a.candidate) {
			return {
				ok: false,
				reason: "invalid",
				code: a.failure?.code ?? ErrorCode.INVALID_PAYLOAD,
				hint: a.failure?.hint,
			}
		}
		if (a.noChanges) return { ok: false, reason: "no_changes" }

		await supersedePending(tx, lyricsId)
		if (a.outcome.goesLive) await retireLiveRevision(tx, lyricsId)
		const revision = await insertRevision(tx, {
			lyricsId,
			content: a.candidate.content,
			format: a.candidate.format,
			syncType: a.candidate.syncType,
			language: a.candidate.language,
			isrc: a.candidate.isrc,
			authorId: userId,
			status: a.outcome.goesLive ? "live" : "pending",
			pendingReason: a.outcome.reason,
			textDrift: a.drift.text,
			timingDrift: a.drift.timing,
			jevProbability: a.jevProbability,
			revertsRevisionId: revert?.revisionId ?? null,
		})
		if (a.outcome.goesLive) await setCurrentRevision(tx, revision)
		const summary = await getRevisionSummary(tx, lyricsId, revision.id)
		return { ok: true, revision: summary! }
	})
	if (result.ok && result.revision.status === "live") {
		await invalidateCacheForLyric(env, lyricsId)
	}
	return result
}

export async function saveRevision(
	env: Env,
	lyricsId: number,
	userId: number,
	input: RevisionInput
): Promise<SaveResult> {
	return commitRevision(env, lyricsId, userId, input, null)
}

export async function revertToRevision(
	env: Env,
	lyricsId: number,
	userId: number,
	targetId: number
): Promise<SaveResult> {
	const target = await getRevisionRow(env.DB, lyricsId, targetId)
	if (!target || (target.status !== "live" && target.status !== "past")) {
		return { ok: false, reason: "not_found" }
	}
	const content = await decompressIfNeeded(target.lyrics)
	return commitRevision(
		env,
		lyricsId,
		userId,
		{ lyrics: content, format: target.format, language: target.language, isrc: target.isrc },
		{ revisionId: target.id, language: target.language, isrc: target.isrc }
	)
}

export async function withdrawPending(
	env: Env,
	lyricsId: number,
	userId: number
): Promise<{ ok: true; revision: RevisionSummary } | AccessFailure> {
	return env.DB.transaction(async (tx) => {
		const lyric = await loadLyricState(tx, lyricsId, true)
		if (!lyric || lyric.deleted_at !== null) return { ok: false, reason: "not_found" } as const
		if (lyric.submitter_id !== userId) return { ok: false, reason: "not_owner" } as const
		const pending = await getPendingRevisionRow(tx, lyricsId)
		if (!pending) return { ok: false, reason: "not_found" } as const
		await setRevisionStatus(tx, pending.id, "withdrawn")
		const revision = await getRevisionSummary(tx, lyricsId, pending.id)
		return { ok: true, revision: revision! } as const
	})
}

async function visibleLyric(env: Env, lyricsId: number): Promise<boolean> {
	const lyric = await loadLyricState(env.DB, lyricsId, false)
	if (!lyric || lyric.deleted_at !== null) return false
	if (lyric.current_revision_id === null) await ensureBaseRevision(env.DB, lyricsId)
	return true
}

export async function listRevisions(env: Env, lyricsId: number): Promise<RevisionSummary[] | null> {
	if (!(await visibleLyric(env, lyricsId))) return null
	return listRevisionSummaries(env.DB, lyricsId)
}

export async function getRevisionDetail(
	env: Env,
	lyricsId: number,
	revisionId: number
): Promise<RevisionDetail | null> {
	if (!(await visibleLyric(env, lyricsId))) return null
	const row = await getRevisionRow(env.DB, lyricsId, revisionId)
	const summary = await getRevisionSummary(env.DB, lyricsId, revisionId)
	if (!row || !summary) return null
	return {
		...summary,
		lyrics: await decompressIfNeeded(row.lyrics),
		format: row.format,
		language: row.language,
		isrc: row.isrc,
	}
}

export async function diffRevisions(
	env: Env,
	lyricsId: number,
	revisionId: number,
	againstId: number | null
): Promise<RevisionDiff | null> {
	if (!(await visibleLyric(env, lyricsId))) return null
	const target = await getRevisionRow(env.DB, lyricsId, revisionId)
	if (!target) return null
	const base =
		againstId === null
			? await getPreviouslyLiveRow(env.DB, lyricsId, target.rev_no)
			: await getRevisionRow(env.DB, lyricsId, againstId)
	if (againstId !== null && !base) return null
	if (!base) return { rows: [], againstRevNo: null }
	return {
		rows: buildDiffRows(
			await revisionLines(base.lyrics, base.format),
			await revisionLines(target.lyrics, target.format)
		),
		againstRevNo: base.rev_no,
	}
}

async function decide(
	env: Env,
	lyricsId: number,
	revisionId: number,
	reviewerId: number,
	apply: (tx: D1Compat, revision: RevisionRow) => Promise<void>
): Promise<DecisionResult> {
	if (!(await isCommittee(env, reviewerId))) return { ok: false, reason: "not_committee" }
	return env.DB.transaction(async (tx): Promise<DecisionResult> => {
		const lyric = await loadLyricState(tx, lyricsId, true)
		if (!lyric || lyric.deleted_at !== null) return { ok: false, reason: "not_found" }
		const revision = await getRevisionRow(tx, lyricsId, revisionId)
		if (!revision) return { ok: false, reason: "not_found" }
		if (revision.status === "superseded" || revision.status === "withdrawn") {
			return { ok: false, reason: "stale" }
		}
		if (revision.status !== "pending") return { ok: false, reason: "already_decided" }
		await apply(tx, revision)
		const summary = await getRevisionSummary(tx, lyricsId, revisionId)
		return { ok: true, revision: summary! }
	})
}

export async function approveRevision(
	env: Env,
	lyricsId: number,
	revisionId: number,
	reviewerId: number
): Promise<DecisionResult> {
	const result = await decide(env, lyricsId, revisionId, reviewerId, async (tx, revision) => {
		await retireLiveRevision(tx, lyricsId)
		await recordReview(tx, revision.id, "live", reviewerId, null)
		await setCurrentRevision(tx, revision)
		await setAnchorRevision(tx, lyricsId, revision.id)
	})
	if (result.ok) await invalidateCacheForLyric(env, lyricsId)
	return result
}

export async function rejectRevision(
	env: Env,
	lyricsId: number,
	revisionId: number,
	reviewerId: number,
	note: string | null
): Promise<DecisionResult> {
	return decide(env, lyricsId, revisionId, reviewerId, (tx, revision) =>
		recordReview(tx, revision.id, "rejected", reviewerId, note)
	)
}

export async function listPendingCards(env: Env): Promise<PendingRevisionCard[]> {
	const rows = await listPendingRevisionRows(env.DB, config.revisions.pendingQueueLimit)
	return Promise.all(
		rows.map(async (row) => {
			const full = unifiedDiff(
				await revisionLines(row.live_lyrics, row.live_format),
				await revisionLines(row.lyrics, row.format),
				{ before: `rev ${row.live_rev_no}`, after: `rev ${row.rev_no}` }
			)
			return {
				lyricsId: row.lyrics_id,
				revisionId: row.id,
				revNo: row.rev_no,
				liveRevNo: row.live_rev_no,
				videoId: row.video_id,
				song: row.song,
				artist: row.artist,
				format: row.format,
				pendingReason: row.pending_reason,
				jevProbability: row.jev_probability,
				textDrift: row.text_drift,
				timingDrift: row.timing_drift,
				author: revisionAuthor(row.author_key_id, row.author_nickname),
				createdAt: row.created_at,
				diffPreview: diffPreview(full),
				diffFull: full,
			}
		})
	)
}
