import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { createReadStream, promises as fsPromises } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import pg from "pg"
import { config } from "@/config"
import { D1Compat } from "@/infra/database"
import { Logger } from "@/infra/logger"
import { createStorage, type Storage } from "@/infra/storage"
import type { Env } from "@/types"
import * as self from "./dump"

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

export interface DumpManifest {
	schema_version: 1
	generated_at: string
	sha256: string
	bytes: number
	dump_url: string
	latest_url: string
	row_counts: {
		lyrics: number
		requested_songs: number
		lyrics_requests: number
	}
	format: "pg_dump custom (-Fc), Postgres 18"
	license: "ODbL-1.0"
	attribution_text: "Lyrics from Unison (https://unison.boidu.dev)"
	enterprise_contact: "enterprise@boidu.dev"
}

export interface BuildManifestInput {
	sha256: string
	bytes: number
	datedKey: string
	publicBaseUrl: string
	now?: Date
}

type DumpTable = "lyrics" | "requested_songs" | "lyrics_requests"

async function countRows(env: Env, table: DumpTable): Promise<number> {
	const row = await env.DB.prepare(
		`SELECT COUNT(*)::INT AS c FROM public_dump.${table}`
	).first<{ c: number }>()
	return row?.c ?? 0
}

export async function buildManifest(
	env: Env,
	input: BuildManifestInput
): Promise<DumpManifest> {
	const [lyrics, requested_songs, lyrics_requests] = await Promise.all([
		countRows(env, "lyrics"),
		countRows(env, "requested_songs"),
		countRows(env, "lyrics_requests"),
	])

	// Bucket keys are organized under `dumps/`, but the public CDN base is rooted
	// at that prefix, so we strip it to avoid `unison-dumps.boidu.dev/dumps/...`.
	const filename = input.datedKey.replace(/^dumps\//, "")
	const generatedAt = (input.now ?? new Date()).toISOString()

	return {
		schema_version: 1,
		generated_at: generatedAt,
		sha256: input.sha256,
		bytes: input.bytes,
		dump_url: `${input.publicBaseUrl}/${filename}`,
		latest_url: `${input.publicBaseUrl}/latest.dump`,
		row_counts: { lyrics, requested_songs, lyrics_requests },
		format: "pg_dump custom (-Fc), Postgres 18",
		license: "ODbL-1.0",
		attribution_text: "Lyrics from Unison (https://unison.boidu.dev)",
		enterprise_contact: "enterprise@boidu.dev",
	}
}

export interface UploadDumpInput {
	storage: Storage
	localPath: string
	sha256: string
	manifest: DumpManifest
	datedKey: string
}

const DATED_DUMP_KEY_PATTERN = /^dumps\/unison-\d{4}-\d{2}-\d{2}\.dump(\.sha256)?$/

export interface PruneOldDumpsInput {
	storage: Storage
	now?: Date
}

export async function pruneOldDumps(
	input: PruneOldDumpsInput
): Promise<{ deleted: string[] }> {
	const now = input.now ?? new Date()
	const cutoff = now.getTime() - config.dump.retentionDays * 24 * 60 * 60 * 1000
	const objects = await input.storage.listObjects("dumps/")
	const deleted: string[] = []
	for (const obj of objects) {
		if (!DATED_DUMP_KEY_PATTERN.test(obj.key)) continue
		if (obj.lastModified.getTime() >= cutoff) continue
		await input.storage.deleteObject(obj.key)
		deleted.push(obj.key)
	}
	return { deleted }
}

export async function uploadDump(input: UploadDumpInput): Promise<void> {
	const datedName = basename(input.datedKey)
	const sidecarKey = `${input.datedKey}.sha256`
	const sidecarBody = `${input.sha256}  ${datedName}\n`
	const manifestBody = JSON.stringify(input.manifest, null, 2)

	await input.storage.putObject(
		input.datedKey,
		createReadStream(input.localPath),
		"application/octet-stream"
	)
	await input.storage.putObject(sidecarKey, Buffer.from(sidecarBody), "text/plain")
	await input.storage.putObject(
		"dumps/manifest.json",
		Buffer.from(manifestBody),
		"application/json"
	)
	await input.storage.putObject(
		"dumps/latest.dump",
		createReadStream(input.localPath),
		"application/octet-stream"
	)
}

export type RunDumpJobResult =
	| { status: "skipped"; reason: "disabled" | "no_storage" }
	| { status: "ok"; datedKey: string; sha256: string; bytes: number; deleted: string[] }
	| { status: "failed"; reason: string }

export interface RunDumpJobOptions {
	storage?: Storage | null
	now?: Date
	tmpDir?: string
}

export async function runDumpJob(
	env: Env,
	opts: RunDumpJobOptions = {}
): Promise<RunDumpJobResult> {
	if (!env.DUMPS_ENABLED) {
		return { status: "skipped", reason: "disabled" }
	}

	const storage = opts.storage !== undefined ? opts.storage : createStorage(env.B2)
	if (!storage) {
		return { status: "skipped", reason: "no_storage" }
	}

	const now = opts.now ?? new Date()
	const dateStr = now.toISOString().slice(0, 10)
	const datedKey = `dumps/unison-${dateStr}.dump`
	const localPath = join(opts.tmpDir ?? tmpdir(), `unison-${dateStr}.dump`)

	const dumpDatabaseUrl = env.DUMP_DATABASE_URL ?? process.env.DATABASE_URL ?? null
	let dumpPool: pg.Pool | null = null
	let dumpEnv = env

	let result: RunDumpJobResult
	try {
		if (!dumpDatabaseUrl) {
			throw new Error("DATABASE_URL is not set")
		}

		if (env.DUMP_DATABASE_URL) {
			dumpPool = new pg.Pool({ connectionString: env.DUMP_DATABASE_URL })
			dumpEnv = { ...env, DB: new D1Compat(dumpPool) }
		}

		await self.materializeDumpSchema(dumpEnv)
		await self.runPgDump({ databaseUrl: dumpDatabaseUrl, outPath: localPath })
		const { sha256, bytes } = await self.verifyDump(localPath)
		const manifest = await self.buildManifest(dumpEnv, {
			sha256,
			bytes,
			datedKey,
			publicBaseUrl: env.DUMP_PUBLIC_BASE_URL,
			now,
		})
		await self.uploadDump({ storage, localPath, sha256, manifest, datedKey })
		const { deleted } = await self.pruneOldDumps({ storage, now })

		log.info("dump complete", {
			datedKey,
			sha256,
			bytes,
			pruned: deleted.length,
		})

		result = { status: "ok", datedKey, sha256, bytes, deleted }
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		log.error("dump failed", { error: message })
		result = { status: "failed", reason: message }
	} finally {
		try {
			await dumpEnv.DB.prepare("DROP SCHEMA IF EXISTS public_dump CASCADE").run()
		} catch (cleanupErr) {
			const message = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)
			log.error("dump schema cleanup failed", { error: message })
		}
		if (dumpPool) {
			try {
				await dumpPool.end()
			} catch (cleanupErr) {
				const message = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)
				log.error("dump pool cleanup failed", { error: message })
			}
		}
		try {
			await fsPromises.rm(localPath, { force: true })
		} catch (cleanupErr) {
			const message = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)
			log.error("dump tempfile cleanup failed", { error: message })
		}
	}

	return result
}
