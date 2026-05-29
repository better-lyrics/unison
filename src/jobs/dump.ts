import { Logger } from "@/infra/logger"
import type { Env } from "@/types"

const log = new Logger("dump")

export const LYRICS_KEEP_COLUMNS = [
	"id",
	"video_id",
	"song",
	"artist",
	"album",
	"isrc",
	"duration",
	"song_norm",
	"artist_norm",
	"album_norm",
	"lyrics",
	"format",
	"language",
	"sync_type",
	"score",
	"upvotes",
	"downvotes",
	"effective_score",
	"vote_count",
	"diversity_bonus",
	"confidence",
	"score_updated_at",
	"created_at",
	"updated_at",
	"deleted_at",
].join(", ")

export const REQUEST_KEEP_COLUMNS = [
	"id",
	"video_id",
	"requester_type",
	"weight",
	"created_at",
].join(", ")

export async function materializeDumpSchema(env: Env): Promise<void> {
	await env.DB.batch([
		env.DB.prepare("DROP SCHEMA IF EXISTS public_dump CASCADE"),
		env.DB.prepare("CREATE SCHEMA public_dump"),
		env.DB.prepare(
			`CREATE TABLE public_dump.lyrics AS SELECT ${LYRICS_KEEP_COLUMNS} FROM public.lyrics`
		),
		env.DB.prepare(
			"CREATE TABLE public_dump.requested_songs AS SELECT * FROM public.requested_songs"
		),
		env.DB.prepare(
			`CREATE TABLE public_dump.lyrics_requests AS SELECT ${REQUEST_KEEP_COLUMNS} FROM public.lyrics_requests`
		),
		env.DB.prepare("CREATE INDEX ON public_dump.lyrics (video_id)"),
		env.DB.prepare("CREATE INDEX ON public_dump.lyrics (effective_score DESC)"),
		env.DB.prepare("CREATE INDEX ON public_dump.lyrics USING GIN (song_norm gin_trgm_ops)"),
		env.DB.prepare("CREATE INDEX ON public_dump.lyrics USING GIN (artist_norm gin_trgm_ops)"),
		env.DB.prepare("CREATE INDEX ON public_dump.lyrics USING GIN (album_norm gin_trgm_ops)"),
	])

	log.info("materialized public_dump schema")
}
