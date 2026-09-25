import { config } from "@/config"

const { syncTypeBoost } = config.ranking
const buildRankingExpr = (prefix: string, committeeBonus = false) => {
	const syncTypeBoostExpr = `CASE ${prefix}sync_type
		WHEN 'richsync' THEN ${syncTypeBoost.richsync}
		WHEN 'linesync' THEN ${syncTypeBoost.linesync}
		ELSE ${syncTypeBoost.plain}
	END`
	const committeeBonusExpr = committeeBonus
		? ` + CASE WHEN ${prefix}committee_approved_at IS NOT NULL THEN ${config.gamification.boost.rankingBonus} ELSE 0 END`
		: ""
	return `(
		(${prefix}effective_score * LN(${prefix}vote_count + ${config.ranking.confidenceBase})
		+ ${config.ranking.recencyWeight} / (1.0 + (EXTRACT(EPOCH FROM NOW())::INTEGER - ${prefix}created_at) / 86400.0)${committeeBonusExpr})
		* ${syncTypeBoostExpr}
	)`
}

export const RANKING_EXPR = buildRankingExpr("")
// Committee bonus applies only to canonical-variant selection of a known video, not song/artist search.
export const RANKING_EXPR_JOINED = buildRankingExpr("l.")
export const RANKING_EXPR_VARIANT = buildRankingExpr("l.", true)

const { autoHide } = config.moderation

const buildAutoHidePredicate = (prefix: string) => `(
	(
		${prefix}vote_count >= ${autoHide.minVotes}
		AND ${prefix}downvotes >= ${autoHide.downvoteRatio} * ${prefix}vote_count
		AND ${prefix}effective_score < ${autoHide.maxEffectiveScore}
	)
	OR
	(
		${prefix}vote_count >= ${autoHide.decisiveMinVotes}
		AND ${prefix}downvotes = ${prefix}vote_count
		AND EXTRACT(EPOCH FROM NOW())::INTEGER - ${prefix}created_at >= ${autoHide.decisiveMinAgeDays * 86400}
	)
)`

export const AUTO_HIDE_PREDICATE = buildAutoHidePredicate("")
export const AUTO_HIDE_PREDICATE_JOINED = buildAutoHidePredicate("l.")

// One IN over a UNION ALL (not `video_id = v OR id IN (...)`) so both branches stay index scans.
export const videoServesExpr = (prefix = "", value = "?") =>
	`${prefix}id IN (SELECT home.id FROM lyrics home WHERE home.video_id = ${value} UNION ALL SELECT link.lyrics_id FROM lyrics_video_ids link WHERE link.video_id = ${value})`

// `%` lets the trigram indexes find candidates; the similarity checks keep the exact cutoff.
// `%` reads pg_trgm.similarity_threshold, so callers must set it to `threshold` first.
export const fuzzyMatch = (normalized: string, threshold: number) => ({
	sql: `(song_norm % ? OR artist_norm % ? OR album_norm % ? OR (song_norm || ' ' || artist_norm) % ?)
				AND (similarity(song_norm, ?) > ?
					OR similarity(artist_norm, ?) > ?
					OR (album_norm IS NOT NULL AND similarity(album_norm, ?) > ?)
					OR similarity(song_norm || ' ' || artist_norm, ?) > ?)`,
	params: [
		normalized,
		normalized,
		normalized,
		normalized,
		normalized,
		threshold,
		normalized,
		threshold,
		normalized,
		threshold,
		normalized,
		threshold,
	],
})

const servableSyncedVariant = `l.sync_type IN ('linesync', 'richsync')
		AND l.deleted_at IS NULL
		AND NOT ${AUTO_HIDE_PREDICATE_JOINED}`

const servesByPrimaryVideo = (videoIdExpr: string) => `EXISTS (
	SELECT 1 FROM lyrics l
	WHERE l.video_id = ${videoIdExpr}
		AND ${servableSyncedVariant}
)`

const servesByLinkedVideo = (videoIdExpr: string) => `EXISTS (
	SELECT 1 FROM lyrics l
	JOIN lyrics_video_ids lvi ON lvi.lyrics_id = l.id
	WHERE lvi.video_id = ${videoIdExpr}
		AND ${servableSyncedVariant}
)`

// Split branches (not `video_id = v OR id IN (subquery)`) so a correlated (NOT) EXISTS stays an
// indexed anti-join instead of collapsing into a per-row sequential scan.
export const servableSyncedVariantServes = (videoIdExpr: string) =>
	`(${servesByPrimaryVideo(videoIdExpr)} OR ${servesByLinkedVideo(videoIdExpr)})`

export const noServableSyncedVariantServes = (videoIdExpr: string) =>
	`(NOT ${servesByPrimaryVideo(videoIdExpr)} AND NOT ${servesByLinkedVideo(videoIdExpr)})`

const { primarySlot } = config.ranking

const provenExpr = (repExpr: string, prefix: string) => `(
	COALESCE(${repExpr}, 0) > ${primarySlot.repFloor}
	OR (
		${prefix}vote_count >= ${primarySlot.minVotes}
		AND ${prefix}effective_score > 0
	)
	OR ${prefix}committee_approved_at IS NOT NULL
)`

export const PROVEN_EXPR_JOINED = provenExpr("u.reputation", "l.")

export const CONSENSUS_LYRICS_CTE = `WITH consensus_lyrics AS (
	SELECT id, CASE WHEN effective_score > 0 THEN 1 ELSE -1 END AS consensus
	FROM lyrics
	WHERE ABS(effective_score) > 0.5 AND vote_count >= ?
)`
