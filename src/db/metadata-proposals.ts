import { config } from "@/config"
import type { SongMetadata } from "@/db/approved-metadata"
import { isCommittee } from "@/db/committee"
import { recordCouncilEvent } from "@/db/council-events"
import { videoServesExpr } from "@/db/predicates"
import { type D1Compat, isUniqueViolation } from "@/infra/database"
import type { Env } from "@/types"
import type { MetadataInput } from "@/utils/metadata-input"
import { normalizeAlbum, normalizeArtist, normalizeSong } from "@/utils/normalize"

export interface OpenProposal {
	id: number
	videoId: string
	lyricsId: number
	proposerId: number
	proposed: SongMetadata
	before: SongMetadata
	approverIds: number[]
	createdAt: number
}

export type ProposeResult =
	| { ok: true; id: number }
	| { ok: false; reason: "not_committee" | "not_found" | "no_changes" | "open" }

export type VoteResult =
	| { ok: true; status: "open"; approvals: number }
	| { ok: true; status: "passed"; lyricIds: number[] }
	| { ok: true; status: "rejected" }
	| { ok: false; reason: "not_committee" | "not_found" | "already_decided" }

const sameMetadata = (a: SongMetadata, b: SongMetadata) =>
	a.song === b.song && a.artist === b.artist && a.album === b.album

const NOW_EPOCH = "EXTRACT(EPOCH FROM NOW())::INTEGER"

export async function createProposal(
	env: Env,
	proposerId: number,
	input: MetadataInput
): Promise<ProposeResult> {
	if (!(await isCommittee(env, proposerId))) return { ok: false, reason: "not_committee" }
	const current = await env.DB.prepare(
		`SELECT id, song, artist, album FROM lyrics
			WHERE id = ? AND deleted_at IS NULL AND ${videoServesExpr()}`
	)
		.bind(input.lyricsId, input.videoId, input.videoId)
		.first<{ id: number; song: string; artist: string; album: string | null }>()
	if (!current) return { ok: false, reason: "not_found" }
	if (sameMetadata(input, current)) return { ok: false, reason: "no_changes" }
	try {
		return await env.DB.transaction(async (tx): Promise<ProposeResult> => {
			const row = await tx
				.prepare(
					`INSERT INTO metadata_proposals
						(video_id, lyrics_id, proposer_id, song, artist, album,
						 before_song, before_artist, before_album)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
				)
				.bind(
					input.videoId,
					current.id,
					proposerId,
					input.song,
					input.artist,
					input.album,
					current.song,
					current.artist,
					current.album
				)
				.first<{ id: number }>()
			const id = Number(row?.id)
			await tx
				.prepare("INSERT INTO metadata_votes (proposal_id, voter_id, approve) VALUES (?, ?, TRUE)")
				.bind(id, proposerId)
				.run()
			await recordCouncilEvent(tx, {
				actorId: proposerId,
				kind: "metadata_propose",
				source: "web",
				lyricsId: current.id,
				refId: id,
			})
			return { ok: true, id }
		})
	} catch (err) {
		if (isUniqueViolation(err)) return { ok: false, reason: "open" }
		throw err
	}
}

async function rewriteVideo(tx: D1Compat, videoId: string, next: SongMetadata): Promise<number[]> {
	const rows = await tx
		.prepare(
			`UPDATE lyrics SET song = ?, artist = ?, album = ?,
				song_norm = ?, artist_norm = ?, album_norm = ?
				WHERE ${videoServesExpr()} RETURNING id`
		)
		.bind(
			next.song,
			next.artist,
			next.album,
			normalizeSong(next.song),
			normalizeArtist(next.artist),
			normalizeAlbum(next.album),
			videoId,
			videoId
		)
		.all<{ id: number }>()
	return rows.results.map((r) => Number(r.id))
}

export async function castVote(
	env: Env,
	proposalId: number,
	voterId: number,
	approve: boolean,
	note: string | null
): Promise<VoteResult> {
	if (!(await isCommittee(env, voterId))) return { ok: false, reason: "not_committee" }
	return env.DB.transaction(async (tx): Promise<VoteResult> => {
		const proposal = await tx
			.prepare(
				`SELECT video_id, lyrics_id, song, artist, album, status
					FROM metadata_proposals WHERE id = ? FOR UPDATE`
			)
			.bind(proposalId)
			.first<SongMetadata & { video_id: string; lyrics_id: number; status: string }>()
		if (!proposal) return { ok: false, reason: "not_found" }
		if (proposal.status !== "open") return { ok: false, reason: "already_decided" }

		const changed = await tx
			.prepare(
				`INSERT INTO metadata_votes (proposal_id, voter_id, approve) VALUES (?, ?, ?)
					ON CONFLICT (proposal_id, voter_id) DO UPDATE SET approve = EXCLUDED.approve
					WHERE metadata_votes.approve IS DISTINCT FROM EXCLUDED.approve
					RETURNING voter_id`
			)
			.bind(proposalId, voterId, approve)
			.first<{ voter_id: number }>()
		if (changed) {
			await recordCouncilEvent(tx, {
				actorId: voterId,
				kind: approve ? "metadata_approve" : "metadata_reject",
				source: "web",
				lyricsId: proposal.lyrics_id,
				refId: proposalId,
				note: approve ? null : note,
			})
		}

		if (!approve) {
			await tx
				.prepare(
					`UPDATE metadata_proposals SET status = 'rejected', decided_at = ${NOW_EPOCH} WHERE id = ?`
				)
				.bind(proposalId)
				.run()
			return { ok: true, status: "rejected" }
		}

		const count = await tx
			.prepare(
				"SELECT COUNT(*)::INTEGER AS n FROM metadata_votes WHERE proposal_id = ? AND approve"
			)
			.bind(proposalId)
			.first<{ n: number }>()
		const approvals = count?.n ?? 0
		if (approvals < config.council.metadataApprovals) return { ok: true, status: "open", approvals }

		const lyricIds = await rewriteVideo(tx, proposal.video_id, proposal)
		await tx
			.prepare(
				`UPDATE metadata_proposals SET status = 'passed', decided_at = ${NOW_EPOCH} WHERE id = ?`
			)
			.bind(proposalId)
			.run()
		return { ok: true, status: "passed", lyricIds }
	})
}

export async function listOpenProposals(env: Env): Promise<OpenProposal[]> {
	const rows = await env.DB.prepare(
		`SELECT p.id, p.video_id, p.lyrics_id, p.proposer_id, p.song, p.artist, p.album,
				p.before_song, p.before_artist, p.before_album, p.created_at,
				COALESCE(
					ARRAY_AGG(v.voter_id ORDER BY v.created_at, v.voter_id) FILTER (WHERE v.approve),
					'{}'
				) AS approver_ids
			FROM metadata_proposals p
			LEFT JOIN metadata_votes v ON v.proposal_id = p.id
			WHERE p.status = 'open'
			GROUP BY p.id
			ORDER BY p.created_at ASC, p.id ASC`
	).all<{
		id: number
		video_id: string
		lyrics_id: number
		proposer_id: number
		song: string
		artist: string
		album: string | null
		before_song: string
		before_artist: string
		before_album: string | null
		created_at: number
		approver_ids: number[]
	}>()
	return rows.results.map((r) => ({
		id: Number(r.id),
		videoId: r.video_id,
		lyricsId: Number(r.lyrics_id),
		proposerId: Number(r.proposer_id),
		proposed: { song: r.song, artist: r.artist, album: r.album },
		before: { song: r.before_song, artist: r.before_artist, album: r.before_album },
		approverIds: r.approver_ids.map(Number),
		createdAt: Number(r.created_at),
	}))
}
