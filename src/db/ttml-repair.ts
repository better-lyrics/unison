import { evictFeedCaches } from "@/db/feed"
import {
	type LyricContentSnapshot,
	ensureBaseRevision,
	getRevisionRow,
	insertRevision,
	loadLyricState,
	restoreLyricContent,
	retireLiveRevision,
	setCurrentRevision,
	setRevisionStatus,
	snapshotLyricContent,
} from "@/db/lyric-revisions"
import { invalidateCacheForLyric, softDeleteLyrics } from "@/db/lyrics"
import type { D1Compat } from "@/infra/database"
import type { Env } from "@/types"
import { decompressIfNeeded } from "@/utils/compression"
import { sha256Hex } from "@/utils/hash"
import { repairTtml } from "@/utils/ttml-repair"
import { findXmlProblem } from "@/utils/validation"

export const TTML_REPAIR_DELETION_REASON = "TTML is not well-formed XML"

export type RepairAction =
	| { kind: "repair"; lyricsId: number; contentHash: string; before: string; after: string }
	| { kind: "delete"; lyricsId: number; contentHash: string; problem: string }
	| {
			kind: "skip"
			lyricsId: number
			reason: "no_submitter" | "open_report_case" | "pending_revision"
	  }

export type ManifestEntry =
	| {
			kind: "repair"
			lyricsId: number
			previousRevisionId: number
			previousAnchorId: number
			repairRevisionId: number
			previous: LyricContentSnapshot
	  }
	| { kind: "delete"; lyricsId: number }

interface StoredLyric {
	id: number
	lyrics: string
	submitter_id: number | null
}

async function hasOpenReportCase(db: D1Compat, lyricsId: number): Promise<boolean> {
	const row = await db
		.prepare("SELECT 1 AS open FROM report_cases WHERE lyrics_id = ? AND status = 'open'")
		.bind(lyricsId)
		.first<{ open: number }>()
	return row !== null
}

async function hasPendingRevision(db: D1Compat, lyricsId: number): Promise<boolean> {
	const row = await db
		.prepare("SELECT 1 AS pending FROM lyric_revisions WHERE lyrics_id = ? AND status = 'pending'")
		.bind(lyricsId)
		.first<{ pending: number }>()
	return row !== null
}

async function liveContent(db: D1Compat, lyricsId: number): Promise<StoredLyric | null> {
	return db
		.prepare(
			"SELECT id, lyrics, submitter_id FROM lyrics WHERE id = ? AND deleted_at IS NULL AND format = 'ttml'"
		)
		.bind(lyricsId)
		.first<StoredLyric>()
}

async function contentHashOf(row: StoredLyric | null): Promise<string | null> {
	return row ? sha256Hex(await decompressIfNeeded(row.lyrics)) : null
}

export async function planTtmlRepairs(
	env: Env,
	{ batchSize = 200 }: { batchSize?: number } = {}
): Promise<RepairAction[]> {
	const actions: RepairAction[] = []
	let afterId = 0
	while (true) {
		const { results } = await env.DB.prepare(
			`SELECT id, lyrics, submitter_id FROM lyrics
			WHERE deleted_at IS NULL AND format = 'ttml' AND id > ?
			ORDER BY id LIMIT ?`
		)
			.bind(afterId, batchSize)
			.all<StoredLyric>()
		if (results.length === 0) return actions
		afterId = results[results.length - 1].id

		for (const row of results) {
			const content = await decompressIfNeeded(row.lyrics)
			const problem = findXmlProblem(content)
			if (!problem) continue
			if (row.submitter_id === null) {
				actions.push({ kind: "skip", lyricsId: row.id, reason: "no_submitter" })
				continue
			}
			const contentHash = sha256Hex(content)
			const repaired = repairTtml(content)
			if (repaired !== null && (await hasPendingRevision(env.DB, row.id))) {
				actions.push({ kind: "skip", lyricsId: row.id, reason: "pending_revision" })
			} else if (repaired !== null) {
				actions.push({
					kind: "repair",
					lyricsId: row.id,
					contentHash,
					before: content,
					after: repaired,
				})
			} else if (await hasOpenReportCase(env.DB, row.id)) {
				actions.push({ kind: "skip", lyricsId: row.id, reason: "open_report_case" })
			} else {
				actions.push({ kind: "delete", lyricsId: row.id, contentHash, problem: problem.message })
			}
		}
	}
}

async function applyRepair(
	env: Env,
	action: Extract<RepairAction, { kind: "repair" }>
): Promise<ManifestEntry | null> {
	const unchanged = async (db: D1Compat) => {
		const stored = await liveContent(db, action.lyricsId)
		if (!stored) return false
		const content = await decompressIfNeeded(stored.lyrics)
		if (sha256Hex(content) !== action.contentHash || repairTtml(content) !== action.after) {
			return false
		}
		return !(await hasPendingRevision(db, action.lyricsId))
	}
	if (!(await unchanged(env.DB))) return null
	await ensureBaseRevision(env.DB, action.lyricsId)
	const entry = await env.DB.transaction(async (tx): Promise<ManifestEntry | null> => {
		const lyric = await loadLyricState(tx, action.lyricsId, true)
		if (!lyric?.current_revision_id || !lyric.anchor_revision_id || lyric.submitter_id === null) {
			return null
		}
		if (!(await unchanged(tx))) return null
		const live = await getRevisionRow(tx, action.lyricsId, lyric.current_revision_id)
		const previous = await snapshotLyricContent(tx, action.lyricsId)
		const metadata = await tx
			.prepare("SELECT language, isrc, album FROM lyrics WHERE id = ?")
			.bind(action.lyricsId)
			.first<{ language: string | null; isrc: string | null; album: string | null }>()
		if (!live || !previous || !metadata) return null

		await retireLiveRevision(tx, action.lyricsId)
		const repair = await insertRevision(tx, {
			lyricsId: action.lyricsId,
			content: action.after,
			format: "ttml",
			syncType: previous.sync_type,
			...metadata,
			authorId: lyric.submitter_id,
			status: "live",
			pendingReason: null,
			textDrift: 0,
			timingDrift: 0,
			jevProbability: null,
			revertsRevisionId: null,
		})
		await setCurrentRevision(tx, repair)
		return {
			kind: "repair",
			lyricsId: action.lyricsId,
			previousRevisionId: live.id,
			previousAnchorId: lyric.anchor_revision_id,
			repairRevisionId: repair.id,
			previous,
		}
	})
	if (entry) await invalidateCacheForLyric(env, action.lyricsId)
	return entry
}

async function applyDelete(
	env: Env,
	action: Extract<RepairAction, { kind: "delete" }>
): Promise<ManifestEntry | null> {
	const stored = await liveContent(env.DB, action.lyricsId)
	if (!stored || stored.submitter_id === null) return null
	if ((await contentHashOf(stored)) !== action.contentHash) return null
	if (await hasOpenReportCase(env.DB, action.lyricsId)) return null
	const result = await softDeleteLyrics(
		env,
		action.lyricsId,
		stored.submitter_id,
		"system",
		TTML_REPAIR_DELETION_REASON
	)
	return result.deleted ? { kind: "delete", lyricsId: action.lyricsId } : null
}

export async function applyTtmlRepairs(
	env: Env,
	actions: RepairAction[],
	onApplied: (entry: ManifestEntry) => void = () => {}
): Promise<ManifestEntry[]> {
	const manifest: ManifestEntry[] = []
	for (const action of actions) {
		const entry =
			action.kind === "repair"
				? await applyRepair(env, action)
				: action.kind === "delete"
					? await applyDelete(env, action)
					: null
		if (!entry) continue
		manifest.push(entry)
		onApplied(entry)
	}
	return manifest
}

async function revertRepair(
	env: Env,
	entry: Extract<ManifestEntry, { kind: "repair" }>
): Promise<boolean> {
	const reverted = await env.DB.transaction(async (tx): Promise<boolean> => {
		const lyric = await loadLyricState(tx, entry.lyricsId, true)
		if (lyric?.current_revision_id !== entry.repairRevisionId) return false
		if (!(await getRevisionRow(tx, entry.lyricsId, entry.previousRevisionId))) return false
		await retireLiveRevision(tx, entry.lyricsId)
		await setRevisionStatus(tx, entry.previousRevisionId, "live")
		await restoreLyricContent(tx, entry.lyricsId, entry.previous, {
			currentRevisionId: entry.previousRevisionId,
			anchorRevisionId: entry.previousAnchorId,
		})
		await tx
			.prepare("DELETE FROM lyric_revisions WHERE id = ? AND lyrics_id = ?")
			.bind(entry.repairRevisionId, entry.lyricsId)
			.run()
		return true
	})
	if (reverted) await invalidateCacheForLyric(env, entry.lyricsId)
	return reverted
}

async function revertDelete(env: Env, entry: Extract<ManifestEntry, { kind: "delete" }>) {
	const restored = await env.DB.prepare(
		`UPDATE lyrics SET deleted_at = NULL, deleted_by_user_id = NULL, deleted_by_role = NULL,
			deletion_reason = NULL
		WHERE id = ? AND deleted_by_role = 'system' AND deletion_reason = ?
		RETURNING id`
	)
		.bind(entry.lyricsId, TTML_REPAIR_DELETION_REASON)
		.first<{ id: number }>()
	if (!restored) return false
	await invalidateCacheForLyric(env, entry.lyricsId)
	await evictFeedCaches(env)
	return true
}

export async function revertTtmlRepairs(
	env: Env,
	manifest: ManifestEntry[]
): Promise<{ reverted: number; skipped: number[] }> {
	let reverted = 0
	const skipped: number[] = []
	for (const entry of [...manifest].reverse()) {
		const ok =
			entry.kind === "repair" ? await revertRepair(env, entry) : await revertDelete(env, entry)
		if (ok) reverted++
		else skipped.push(entry.lyricsId)
	}
	return { reverted, skipped }
}
