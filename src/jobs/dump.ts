import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { config } from "@/config"
import { Logger } from "@/infra/logger"
import type { Env } from "@/types"

const log = new Logger("dump")

export interface RunPgDumpOptions {
	databaseUrl: string
	outPath: string
}

export function runPgDump(opts: RunPgDumpOptions): Promise<void> {
	const args = [
		"-Fc",
		"--no-owner",
		"--no-privileges",
		"--schema=public_dump",
		"-f",
		opts.outPath,
		opts.databaseUrl,
	]
	return new Promise((resolve, reject) => {
		const child = spawn("pg_dump", args, { stdio: ["ignore", "ignore", "pipe"] })
		let stderr = ""
		child.stderr?.on("data", (chunk: Buffer | string) => {
			stderr += chunk.toString()
		})
		child.on("error", reject)
		child.on("close", (code) => {
			if (code === 0) {
				resolve()
				return
			}
			reject(new Error(`pg_dump exit ${code}: ${stderr.trim()}`))
		})
	})
}

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

export interface VerifyDumpResult {
	sha256: string
	bytes: number
}

export function verifyDump(filePath: string): Promise<VerifyDumpResult> {
	return new Promise((resolve, reject) => {
		const hash = createHash("sha256")
		const stream = createReadStream(filePath)
		let bytes = 0
		stream.on("data", (chunk) => {
			hash.update(chunk)
			bytes += chunk.length
		})
		stream.on("error", reject)
		stream.on("end", () => {
			if (bytes < config.dump.minBytes) {
				reject(
					new Error(`dump size ${bytes} bytes is below floor ${config.dump.minBytes} bytes`)
				)
				return
			}
			resolve({ sha256: hash.digest("hex"), bytes })
		})
	})
}
