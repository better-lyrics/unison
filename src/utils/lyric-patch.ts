import { config } from "@/config"
import type { DecisionRole, PendingReason } from "@/types"

export type DecisionRefusal = "not_committee" | "own_patch" | "owner_window"

export const isPatch = (authorId: number | null, submitterId: number | null): boolean =>
	authorId !== null && authorId !== submitterId

export const patchSql = (revision: string, lyric: string): string =>
	`(${revision}.author_id IS NOT NULL AND ${revision}.author_id IS DISTINCT FROM ${lyric}.submitter_id)`

export const waitingSuggestionSql = (revision: string, lyric: string): string =>
	`(${revision}.status = 'pending' AND ${patchSql(revision, lyric)})`

export const ownerDecisionSql = (revision: string, lyric: string): string =>
	`(${revision}.reviewed_by IS NOT DISTINCT FROM ${lyric}.submitter_id AND ${patchSql(revision, lyric)} AND NOT EXISTS (SELECT 1 FROM council_events ce WHERE ce.kind IN ('edit_approve', 'edit_reject') AND ce.ref_id = ${revision}.id))`

export const ownerlessSql = (lyric: string): string => `(${lyric}.submitter_id IS NULL)`

export const ownerWindowOpenSql = (revision: string, lyric: string): string =>
	`(${revision}.pending_reason = 'suggested' AND ${lyric}.committee_approved_at IS NULL AND NOT ${ownerlessSql(lyric)} AND ${revision}.created_at > EXTRACT(EPOCH FROM NOW())::INTEGER - ${config.revisions.ownerDecisionSec})`

export const suggestionDecider = (
	reason: PendingReason | null,
	sealed: boolean,
	ownerless: boolean
): DecisionRole => (reason === "suggested" && !sealed && !ownerless ? "owner" : "council")

export function councilDecidesAt(
	reason: PendingReason | null,
	sealed: boolean,
	ownerless: boolean,
	createdAt: number,
	now: number
): number | null {
	if (suggestionDecider(reason, sealed, ownerless) === "council") return null
	const opensAt = createdAt + config.revisions.ownerDecisionSec
	return opensAt > now ? opensAt : null
}

export interface DecisionInput {
	action: "approve" | "reject"
	reviewerId: number
	isCouncil: boolean
	submitterId: number | null
	authorId: number | null
	reason: PendingReason | null
	sealed: boolean
	ownerless: boolean
	createdAt: number
	now: number
}

export function decisionRole(
	input: DecisionInput
): { ok: true; role: DecisionRole } | { ok: false; reason: DecisionRefusal } {
	if (!isPatch(input.authorId, input.submitterId)) {
		return input.isCouncil ? { ok: true, role: "council" } : { ok: false, reason: "not_committee" }
	}
	if (input.reviewerId === input.authorId) return { ok: false, reason: "own_patch" }
	if (
		input.reviewerId === input.submitterId &&
		(input.action === "reject" ||
			suggestionDecider(input.reason, input.sealed, input.ownerless) === "owner")
	) {
		return { ok: true, role: "owner" }
	}
	if (!input.isCouncil) return { ok: false, reason: "not_committee" }
	if (
		councilDecidesAt(input.reason, input.sealed, input.ownerless, input.createdAt, input.now) !==
		null
	) {
		return { ok: false, reason: "owner_window" }
	}
	return { ok: true, role: "council" }
}
