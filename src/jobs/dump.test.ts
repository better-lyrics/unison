import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { EventEmitter } from "node:events"
import fs from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { config } from "@/config"
import type { Storage } from "@/infra/storage"
import type { Env } from "@/types"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as dump from "@/jobs/dump"
import {
	buildManifest,
	type DumpManifest,
	LYRICS_KEEP_COLUMNS,
	materializeDumpSchema,
	pruneOldDumps,
	REQUEST_KEEP_COLUMNS,
	runDumpJob,
	runPgDump,
	uploadDump,
	verifyDump,
} from "@/jobs/dump"

vi.mock("node:child_process", () => ({ spawn: vi.fn() }))

interface FakeStatement {
	sql: string
}

function createMockEnv(): {
	env: Env
	prepared: FakeStatement[]
	batches: FakeStatement[][]
} {
	const prepared: FakeStatement[] = []
	const batches: FakeStatement[][] = []
	const db = {
		prepare(sql: string): FakeStatement {
			const stmt = { sql }
			prepared.push(stmt)
			return stmt
		},
		async batch(statements: FakeStatement[]): Promise<void> {
			batches.push(statements)
		},
	}
	const env = { DB: db } as unknown as Env
	return { env, prepared, batches }
}

describe("materializeDumpSchema", () => {
	it("issues a single batch call", async () => {
		const { env, batches } = createMockEnv()
		await materializeDumpSchema(env)
		expect(batches).toHaveLength(1)
	})

	it("starts with DROP SCHEMA then CREATE SCHEMA for public_dump", async () => {
		const { env, batches } = createMockEnv()
		await materializeDumpSchema(env)
		const stmts = batches[0]
		expect(stmts[0].sql).toMatch(/DROP\s+SCHEMA\s+IF\s+EXISTS\s+public_dump\s+CASCADE/i)
		expect(stmts[1].sql).toMatch(/CREATE\s+SCHEMA\s+public_dump/i)
	})

	it("creates public_dump.lyrics from public.lyrics via CREATE TABLE AS", async () => {
		const { env, batches } = createMockEnv()
		await materializeDumpSchema(env)
		const lyricsCreate = batches[0].find(
			(s) => /CREATE\s+TABLE\s+public_dump\.lyrics\s+AS/i.test(s.sql)
		)
		expect(lyricsCreate).toBeDefined()
		expect(lyricsCreate?.sql).toMatch(/FROM\s+public\.lyrics/i)
	})

	it("creates public_dump.requested_songs from public.requested_songs", async () => {
		const { env, batches } = createMockEnv()
		await materializeDumpSchema(env)
		const found = batches[0].find(
			(s) => /CREATE\s+TABLE\s+public_dump\.requested_songs\s+AS/i.test(s.sql)
		)
		expect(found).toBeDefined()
		expect(found?.sql).toMatch(/FROM\s+public\.requested_songs/i)
	})

	it("creates public_dump.lyrics_requests from public.lyrics_requests", async () => {
		const { env, batches } = createMockEnv()
		await materializeDumpSchema(env)
		const found = batches[0].find(
			(s) => /CREATE\s+TABLE\s+public_dump\.lyrics_requests\s+AS/i.test(s.sql)
		)
		expect(found).toBeDefined()
		expect(found?.sql).toMatch(/FROM\s+public\.lyrics_requests/i)
	})

	it("lyrics dump does not leak submitter_id, tsvector, or moderation columns", async () => {
		const { env, batches } = createMockEnv()
		await materializeDumpSchema(env)
		const lyricsCreate = batches[0].find(
			(s) => /CREATE\s+TABLE\s+public_dump\.lyrics\s+AS/i.test(s.sql)
		)
		const sql = lyricsCreate?.sql ?? ""
		expect(sql).not.toMatch(/submitter_id/i)
		expect(sql).not.toMatch(/lyrics_text_search/i)
		expect(sql).not.toMatch(/deleted_by_user_id/i)
		expect(sql).not.toMatch(/deleted_by_role/i)
		expect(sql).not.toMatch(/deletion_reason/i)
	})

	it("lyrics dump keeps the documented columns", async () => {
		const { env, batches } = createMockEnv()
		await materializeDumpSchema(env)
		const lyricsCreate = batches[0].find(
			(s) => /CREATE\s+TABLE\s+public_dump\.lyrics\s+AS/i.test(s.sql)
		)
		const sql = lyricsCreate?.sql ?? ""
		const expected = [
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
		]
		for (const col of expected) {
			expect(sql).toMatch(new RegExp(`\\b${col}\\b`))
		}
	})

	it("lyrics_requests dump does not leak requester_id", async () => {
		const { env, batches } = createMockEnv()
		await materializeDumpSchema(env)
		const stmt = batches[0].find(
			(s) => /CREATE\s+TABLE\s+public_dump\.lyrics_requests\s+AS/i.test(s.sql)
		)
		expect(stmt?.sql).not.toMatch(/requester_id/i)
	})

	it("lyrics_requests dump keeps the documented columns", async () => {
		const { env, batches } = createMockEnv()
		await materializeDumpSchema(env)
		const stmt = batches[0].find(
			(s) => /CREATE\s+TABLE\s+public_dump\.lyrics_requests\s+AS/i.test(s.sql)
		)
		const sql = stmt?.sql ?? ""
		for (const col of ["id", "video_id", "requester_type", "weight", "created_at"]) {
			expect(sql).toMatch(new RegExp(`\\b${col}\\b`))
		}
	})

	it("never references excluded tables", async () => {
		const { env, batches } = createMockEnv()
		await materializeDumpSchema(env)
		const allSql = batches[0].map((s) => s.sql).join("\n")
		for (const table of ["users", "votes", "reports", "public_keys"]) {
			expect(allSql).not.toMatch(new RegExp(`\\b${table}\\b`))
		}
	})

	it("creates trigram GIN indexes on song_norm, artist_norm, album_norm", async () => {
		const { env, batches } = createMockEnv()
		await materializeDumpSchema(env)
		const stmts = batches[0].map((s) => s.sql)
		const gin = stmts.filter((s) => /USING\s+GIN/i.test(s) && /gin_trgm_ops/i.test(s))
		expect(gin.some((s) => /song_norm/i.test(s))).toBe(true)
		expect(gin.some((s) => /artist_norm/i.test(s))).toBe(true)
		expect(gin.some((s) => /album_norm/i.test(s))).toBe(true)
	})

	it("creates b-tree indexes on video_id and effective_score DESC", async () => {
		const { env, batches } = createMockEnv()
		await materializeDumpSchema(env)
		const stmts = batches[0].map((s) => s.sql)
		expect(
			stmts.some((s) => /CREATE\s+INDEX/i.test(s) && /public_dump\.lyrics\s*\(video_id\)/i.test(s))
		).toBe(true)
		expect(
			stmts.some(
				(s) =>
					/CREATE\s+INDEX/i.test(s) &&
					/public_dump\.lyrics\s*\(effective_score\s+DESC\)/i.test(s)
			)
		).toBe(true)
	})

	it("exports column lists as comma-joined strings", () => {
		expect(typeof LYRICS_KEEP_COLUMNS).toBe("string")
		expect(typeof REQUEST_KEEP_COLUMNS).toBe("string")
		expect(LYRICS_KEEP_COLUMNS).toContain("video_id")
		expect(REQUEST_KEEP_COLUMNS).toContain("requester_type")
	})
})

interface FakeChildOptions {
	exitCode?: number
	stderr?: string
	spawnError?: Error
}

function buildFakeProc(opts: FakeChildOptions) {
	const proc = new EventEmitter() as EventEmitter & {
		stderr: EventEmitter
	}
	proc.stderr = new EventEmitter()
	setImmediate(() => {
		if (opts.spawnError) {
			proc.emit("error", opts.spawnError)
			return
		}
		if (opts.stderr) {
			proc.stderr.emit("data", Buffer.from(opts.stderr))
		}
		proc.emit("close", opts.exitCode ?? 0)
	})
	return proc
}

const spawnMock = vi.mocked(spawn)

describe("runPgDump", () => {
	beforeEach(() => {
		spawnMock.mockReset()
	})

	it("invokes pg_dump with the correct flags and connection string last", async () => {
		spawnMock.mockReturnValueOnce(buildFakeProc({ exitCode: 0 }) as never)
		await runPgDump({
			databaseUrl: "postgres://user:pw@host:5432/db",
			outPath: "/tmp/out.dump",
		})
		expect(spawnMock).toHaveBeenCalledTimes(1)
		expect(spawnMock).toHaveBeenCalledWith(
			"pg_dump",
			[
				"-Fc",
				"--no-owner",
				"--no-privileges",
				"--schema=public_dump",
				"-f",
				"/tmp/out.dump",
				"postgres://user:pw@host:5432/db",
			],
			expect.anything()
		)
	})

	it("resolves on exit code 0", async () => {
		spawnMock.mockReturnValueOnce(buildFakeProc({ exitCode: 0 }) as never)
		await expect(
			runPgDump({
				databaseUrl: "postgres://localhost/db",
				outPath: "/tmp/out.dump",
			})
		).resolves.toBeUndefined()
	})

	it("rejects with exit code and stderr on non-zero exit", async () => {
		spawnMock.mockReturnValueOnce(
			buildFakeProc({ exitCode: 1, stderr: "connection refused" }) as never
		)
		await expect(
			runPgDump({
				databaseUrl: "postgres://localhost/db",
				outPath: "/tmp/out.dump",
			})
		).rejects.toThrow(/pg_dump exit 1.*connection refused/)
	})

	it("rejects when the child process emits an error event", async () => {
		const err = Object.assign(new Error("spawn pg_dump ENOENT"), { code: "ENOENT" })
		spawnMock.mockReturnValueOnce(buildFakeProc({ spawnError: err }) as never)
		await expect(
			runPgDump({
				databaseUrl: "postgres://localhost/db",
				outPath: "/tmp/out.dump",
			})
		).rejects.toThrow(/ENOENT/)
	})
})

async function withTempFile(bytes: Buffer, fn: (path: string) => Promise<void>) {
	const dir = await mkdtemp(join(tmpdir(), "dump-test-"))
	const path = join(dir, "test.dump")
	try {
		await writeFile(path, bytes)
		await fn(path)
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
}

describe("verifyDump", () => {
	it("returns the correct sha256 and byte count for a file at or above the floor", async () => {
		const size = config.dump.minBytes + 1024
		const buf = Buffer.alloc(size, 0x61)
		const expectedSha = createHash("sha256").update(buf).digest("hex")
		await withTempFile(buf, async (path) => {
			const result = await verifyDump(path)
			expect(result.bytes).toBe(size)
			expect(result.sha256).toBe(expectedSha)
			expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
		})
	})

	it("throws when the file is below the floor", async () => {
		const buf = Buffer.alloc(100, 0x61)
		await withTempFile(buf, async (path) => {
			await expect(verifyDump(path)).rejects.toThrow(
				new RegExp(`dump size 100 bytes is below floor ${config.dump.minBytes} bytes`)
			)
		})
	})
})

interface CountRow {
	c: number
}

function createManifestMockEnv(counts: number[]): {
	env: Env
	prepared: string[]
} {
	const prepared: string[] = []
	let callIdx = 0
	const db = {
		prepare(sql: string) {
			prepared.push(sql)
			return {
				async first<T>(): Promise<T | null> {
					const c = counts[callIdx++]
					return { c } as unknown as T
				},
			}
		},
	}
	const env = { DB: db } as unknown as Env
	return { env, prepared }
}

describe("buildManifest", () => {
	const baseInput = {
		sha256: "a".repeat(64),
		bytes: 12_345_678,
		datedKey: "dumps/unison-2026-05-29.dump",
		publicBaseUrl: "https://dumps.unison.boidu.dev",
		now: new Date("2026-05-29T12:34:56.000Z"),
	}

	it("returns the documented static fields plus inputs", async () => {
		const { env } = createManifestMockEnv([100, 10, 5])
		const manifest = await buildManifest(env, baseInput)
		expect(manifest.schema_version).toBe(1)
		expect(manifest.sha256).toBe(baseInput.sha256)
		expect(manifest.bytes).toBe(baseInput.bytes)
		expect(manifest.generated_at).toBe("2026-05-29T12:34:56.000Z")
		expect(manifest.license).toBe("ODbL-1.0")
		expect(manifest.attribution_text).toContain("Unison")
		expect(manifest.enterprise_contact).toBe("enterprise@boidu.dev")
		expect(manifest.format).toBe("pg_dump custom (-Fc), Postgres 18")
	})

	it("populates row_counts from the three COUNT(*) queries against public_dump", async () => {
		const { env, prepared } = createManifestMockEnv([100, 10, 5])
		const manifest = await buildManifest(env, baseInput)
		expect(manifest.row_counts.lyrics).toBe(100)
		expect(manifest.row_counts.requested_songs).toBe(10)
		expect(manifest.row_counts.lyrics_requests).toBe(5)
		expect(prepared).toHaveLength(3)
		expect(prepared[0]).toMatch(/COUNT\(\*\)/i)
		expect(prepared[0]).toMatch(/public_dump\.lyrics\b/i)
		expect(prepared[1]).toMatch(/public_dump\.requested_songs\b/i)
		expect(prepared[2]).toMatch(/public_dump\.lyrics_requests\b/i)
	})

	it("constructs dump_url from the public base url and dump filename without doubling dumps/", async () => {
		const { env } = createManifestMockEnv([1, 2, 3])
		const manifest = await buildManifest(env, baseInput)
		expect(manifest.dump_url).toBe(
			"https://dumps.unison.boidu.dev/unison-2026-05-29.dump"
		)
		expect(manifest.latest_url).toBe("https://dumps.unison.boidu.dev/latest.dump")
	})

	it("generated_at is a UTC ISO 8601 string derived from input.now", async () => {
		const { env } = createManifestMockEnv([0, 0, 0])
		const now = new Date("2030-01-02T03:04:05.678Z")
		const manifest = await buildManifest(env, { ...baseInput, now })
		expect(manifest.generated_at).toBe(now.toISOString())
		expect(manifest.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
	})
})

interface RecordedPut {
	key: string
	contentType: string
	bodyKind: "buffer" | "string" | "stream"
	body: string
}

function buildMockStorage() {
	const puts: RecordedPut[] = []
	const storage: Storage = {
		putObject: vi.fn(async (key, body, contentType) => {
			const bodyKind: RecordedPut["bodyKind"] = Buffer.isBuffer(body)
				? "buffer"
				: typeof body === "string"
					? "string"
					: "stream"
			const bodyText =
				typeof body === "string" || Buffer.isBuffer(body) ? body.toString() : "<stream>"
			puts.push({ key, contentType, bodyKind, body: bodyText })
		}),
		listObjects: vi.fn(async () => []),
		deleteObject: vi.fn(async () => {}),
		__client: null as never,
	}
	return { storage, puts }
}

const sampleManifest: DumpManifest = {
	schema_version: 1,
	generated_at: "2026-05-29T12:34:56.000Z",
	sha256: "b".repeat(64),
	bytes: 4096,
	dump_url: "https://dumps.unison.boidu.dev/unison-2026-05-29.dump",
	latest_url: "https://dumps.unison.boidu.dev/latest.dump",
	row_counts: { lyrics: 100, requested_songs: 10, lyrics_requests: 5 },
	format: "pg_dump custom (-Fc), Postgres 18",
	license: "ODbL-1.0",
	attribution_text: "Lyrics from Unison (https://unison.boidu.dev)",
	enterprise_contact: "enterprise@boidu.dev",
}

describe("uploadDump", () => {
	it("uploads the four keys in the documented order", async () => {
		const fileBytes = Buffer.alloc(2048, 0x7a)
		await withTempFile(fileBytes, async (path) => {
			const { storage, puts } = buildMockStorage()
			const datedKey = "dumps/unison-2026-05-29.dump"
			await uploadDump({
				storage,
				localPath: path,
				sha256: sampleManifest.sha256,
				manifest: sampleManifest,
				datedKey,
			})
			expect(puts.map((p) => p.key)).toEqual([
				"dumps/unison-2026-05-29.dump",
				"dumps/unison-2026-05-29.dump.sha256",
				"dumps/manifest.json",
				"dumps/latest.dump",
			])
		})
	})

	it("uploads the manifest as application/json with JSON that round-trips", async () => {
		const fileBytes = Buffer.alloc(2048, 0x7a)
		await withTempFile(fileBytes, async (path) => {
			const { storage, puts } = buildMockStorage()
			const datedKey = "dumps/unison-2026-05-29.dump"
			await uploadDump({
				storage,
				localPath: path,
				sha256: sampleManifest.sha256,
				manifest: sampleManifest,
				datedKey,
			})
			const manifestPut = puts.find((p) => p.key === "dumps/manifest.json")
			expect(manifestPut).toBeDefined()
			expect(manifestPut?.contentType).toBe("application/json")
			expect(JSON.parse(manifestPut?.body ?? "")).toEqual(sampleManifest)
		})
	})

	it("writes the sha256 sidecar as text/plain in sha256sum -c format", async () => {
		const fileBytes = Buffer.alloc(2048, 0x7a)
		await withTempFile(fileBytes, async (path) => {
			const { storage, puts } = buildMockStorage()
			const datedKey = "dumps/unison-2026-05-29.dump"
			await uploadDump({
				storage,
				localPath: path,
				sha256: sampleManifest.sha256,
				manifest: sampleManifest,
				datedKey,
			})
			const sidecar = puts.find((p) => p.key === "dumps/unison-2026-05-29.dump.sha256")
			expect(sidecar).toBeDefined()
			expect(sidecar?.contentType).toBe("text/plain")
			expect(sidecar?.body).toBe(`${sampleManifest.sha256}  ${basename(datedKey)}\n`)
		})
	})

	it("streams the dated and latest dump bodies as application/octet-stream", async () => {
		const fileBytes = Buffer.alloc(2048, 0x7a)
		await withTempFile(fileBytes, async (path) => {
			const { storage, puts } = buildMockStorage()
			const datedKey = "dumps/unison-2026-05-29.dump"
			await uploadDump({
				storage,
				localPath: path,
				sha256: sampleManifest.sha256,
				manifest: sampleManifest,
				datedKey,
			})
			const dated = puts.find((p) => p.key === datedKey)
			const latest = puts.find((p) => p.key === "dumps/latest.dump")
			expect(dated?.contentType).toBe("application/octet-stream")
			expect(dated?.bodyKind).toBe("stream")
			expect(latest?.contentType).toBe("application/octet-stream")
			expect(latest?.bodyKind).toBe("stream")
		})
	})
})

function buildMockStorageWithObjects(objects: { key: string; lastModified: Date }[]) {
	const deleted: string[] = []
	const storage: Storage = {
		putObject: vi.fn(),
		listObjects: vi.fn(async () => objects),
		deleteObject: vi.fn(async (key) => {
			deleted.push(key)
		}),
		__client: null as never,
	}
	return { storage, deleted }
}

describe("pruneOldDumps", () => {
	const now = new Date("2026-05-29T00:00:00.000Z")
	const recent = new Date("2026-05-28T00:00:00.000Z")
	const old = new Date("2026-05-21T00:00:00.000Z")
	const veryOld = new Date("2026-05-01T00:00:00.000Z")

	it("deletes dated dumps older than retentionDays past now", async () => {
		const { storage, deleted } = buildMockStorageWithObjects([
			{ key: "dumps/unison-2026-05-29.dump", lastModified: now },
			{ key: "dumps/unison-2026-05-21.dump", lastModified: old },
			{ key: "dumps/latest.dump", lastModified: now },
			{ key: "dumps/manifest.json", lastModified: now },
		])
		const result = await pruneOldDumps({ storage, now })
		expect(result).toEqual({ deleted: ["dumps/unison-2026-05-21.dump"] })
		expect(deleted).toEqual(["dumps/unison-2026-05-21.dump"])
	})

	it("never deletes latest.dump even when older than retention", async () => {
		const { storage, deleted } = buildMockStorageWithObjects([
			{ key: "dumps/latest.dump", lastModified: veryOld },
		])
		const result = await pruneOldDumps({ storage, now })
		expect(result.deleted).toEqual([])
		expect(deleted).toEqual([])
	})

	it("never deletes manifest.json even when older than retention", async () => {
		const { storage, deleted } = buildMockStorageWithObjects([
			{ key: "dumps/manifest.json", lastModified: veryOld },
		])
		const result = await pruneOldDumps({ storage, now })
		expect(result.deleted).toEqual([])
		expect(deleted).toEqual([])
	})

	it("also deletes the .sha256 sidecar of an old dump", async () => {
		const { storage, deleted } = buildMockStorageWithObjects([
			{ key: "dumps/unison-2026-05-21.dump", lastModified: old },
			{ key: "dumps/unison-2026-05-21.dump.sha256", lastModified: old },
			{ key: "dumps/latest.dump", lastModified: now },
			{ key: "dumps/manifest.json", lastModified: now },
		])
		const result = await pruneOldDumps({ storage, now })
		expect(result.deleted.sort()).toEqual([
			"dumps/unison-2026-05-21.dump",
			"dumps/unison-2026-05-21.dump.sha256",
		])
		expect(deleted.sort()).toEqual([
			"dumps/unison-2026-05-21.dump",
			"dumps/unison-2026-05-21.dump.sha256",
		])
	})

	it("returns an empty deleted list when nothing is past retention", async () => {
		const { storage, deleted } = buildMockStorageWithObjects([
			{ key: "dumps/unison-2026-05-29.dump", lastModified: now },
			{ key: "dumps/unison-2026-05-28.dump", lastModified: recent },
			{ key: "dumps/latest.dump", lastModified: now },
			{ key: "dumps/manifest.json", lastModified: now },
		])
		const result = await pruneOldDumps({ storage, now })
		expect(result.deleted).toEqual([])
		expect(deleted).toEqual([])
	})

	it("uses input.now when provided for the cutoff math", async () => {
		const fixedNow = new Date("2026-06-15T12:00:00.000Z")
		const justInside = new Date("2026-06-09T12:00:01.000Z")
		const justOutside = new Date("2026-06-08T11:59:59.000Z")
		const { storage, deleted } = buildMockStorageWithObjects([
			{ key: "dumps/unison-2026-06-09.dump", lastModified: justInside },
			{ key: "dumps/unison-2026-06-08.dump", lastModified: justOutside },
		])
		const result = await pruneOldDumps({ storage, now: fixedNow })
		expect(result.deleted).toEqual(["dumps/unison-2026-06-08.dump"])
		expect(deleted).toEqual(["dumps/unison-2026-06-08.dump"])
	})
})

interface RunDumpJobMockEnv {
	env: Env
	runCalls: string[]
}

function createRunDumpJobEnv(opts: { dumpsEnabled: boolean; hasB2: boolean }): RunDumpJobMockEnv {
	const runCalls: string[] = []
	const db = {
		prepare(sql: string) {
			return {
				async run() {
					runCalls.push(sql)
				},
				async first<T>(): Promise<T | null> {
					return null
				},
			}
		},
		async batch(): Promise<void> {},
	}
	const env = {
		DB: db,
		DUMPS_ENABLED: opts.dumpsEnabled,
		DUMP_PUBLIC_BASE_URL: "https://dumps.unison.boidu.dev",
		B2: opts.hasB2
			? {
					keyId: "k",
					applicationKey: "a",
					bucket: "b",
					endpoint: "https://example.com",
				}
			: null,
	} as unknown as Env
	return { env, runCalls }
}

function buildInjectableStorage(): Storage {
	return {
		putObject: vi.fn(async () => {}),
		listObjects: vi.fn(async () => []),
		deleteObject: vi.fn(async () => {}),
		__client: null as never,
	}
}

describe("runDumpJob", () => {
	const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL

	beforeEach(() => {
		process.env.DATABASE_URL = "postgres://test:test@localhost/test"
		vi.restoreAllMocks()
	})

	afterEach(() => {
		process.env.DATABASE_URL = ORIGINAL_DATABASE_URL
		vi.restoreAllMocks()
	})

	it("returns skipped/disabled when DUMPS_ENABLED is false without touching the DB", async () => {
		const { env, runCalls } = createRunDumpJobEnv({ dumpsEnabled: false, hasB2: true })
		const materializeSpy = vi.spyOn(dump, "materializeDumpSchema").mockResolvedValue()
		const runSpy = vi.spyOn(dump, "runPgDump").mockResolvedValue()
		const verifySpy = vi
			.spyOn(dump, "verifyDump")
			.mockResolvedValue({ sha256: "abc", bytes: 1234 })
		const buildSpy = vi
			.spyOn(dump, "buildManifest")
			.mockResolvedValue({} as unknown as DumpManifest)
		const uploadSpy = vi.spyOn(dump, "uploadDump").mockResolvedValue()
		const pruneSpy = vi.spyOn(dump, "pruneOldDumps").mockResolvedValue({ deleted: [] })

		const result = await runDumpJob(env, { storage: buildInjectableStorage() })

		expect(result).toEqual({ status: "skipped", reason: "disabled" })
		expect(materializeSpy).not.toHaveBeenCalled()
		expect(runSpy).not.toHaveBeenCalled()
		expect(verifySpy).not.toHaveBeenCalled()
		expect(buildSpy).not.toHaveBeenCalled()
		expect(uploadSpy).not.toHaveBeenCalled()
		expect(pruneSpy).not.toHaveBeenCalled()
		expect(runCalls).toEqual([])
	})

	it("returns skipped/no_storage when enabled but storage is null", async () => {
		const { env } = createRunDumpJobEnv({ dumpsEnabled: true, hasB2: false })
		const materializeSpy = vi.spyOn(dump, "materializeDumpSchema").mockResolvedValue()

		const result = await runDumpJob(env, { storage: null })

		expect(result).toEqual({ status: "skipped", reason: "no_storage" })
		expect(materializeSpy).not.toHaveBeenCalled()
	})

	it("happy path: runs the pipeline in order and returns ok with datedKey/sha/bytes/deleted", async () => {
		const { env } = createRunDumpJobEnv({ dumpsEnabled: true, hasB2: true })
		const callOrder: string[] = []
		vi.spyOn(dump, "materializeDumpSchema").mockImplementation(async () => {
			callOrder.push("materialize")
		})
		vi.spyOn(dump, "runPgDump").mockImplementation(async () => {
			callOrder.push("runPgDump")
		})
		vi.spyOn(dump, "verifyDump").mockImplementation(async () => {
			callOrder.push("verify")
			return { sha256: "deadbeef", bytes: 99 }
		})
		vi.spyOn(dump, "buildManifest").mockImplementation(async () => {
			callOrder.push("build")
			return {} as unknown as DumpManifest
		})
		vi.spyOn(dump, "uploadDump").mockImplementation(async () => {
			callOrder.push("upload")
		})
		vi.spyOn(dump, "pruneOldDumps").mockImplementation(async () => {
			callOrder.push("prune")
			return { deleted: ["dumps/unison-2026-05-20.dump"] }
		})
		vi.spyOn(fs.promises, "rm").mockResolvedValue()

		const now = new Date("2026-05-29T00:00:00.000Z")
		const result = await runDumpJob(env, {
			storage: buildInjectableStorage(),
			now,
			tmpDir: "/tmp",
		})

		expect(result).toEqual({
			status: "ok",
			datedKey: "dumps/unison-2026-05-29.dump",
			sha256: "deadbeef",
			bytes: 99,
			deleted: ["dumps/unison-2026-05-20.dump"],
		})
		expect(callOrder).toEqual([
			"materialize",
			"runPgDump",
			"verify",
			"build",
			"upload",
			"prune",
		])
	})

	it("runs DROP SCHEMA cleanup in finally even when uploadDump rejects", async () => {
		const { env, runCalls } = createRunDumpJobEnv({ dumpsEnabled: true, hasB2: true })
		vi.spyOn(dump, "materializeDumpSchema").mockResolvedValue()
		vi.spyOn(dump, "runPgDump").mockResolvedValue()
		vi.spyOn(dump, "verifyDump").mockResolvedValue({ sha256: "abc", bytes: 1234 })
		vi.spyOn(dump, "buildManifest").mockResolvedValue({} as unknown as DumpManifest)
		vi.spyOn(dump, "uploadDump").mockRejectedValueOnce(new Error("upload boom"))
		vi.spyOn(dump, "pruneOldDumps").mockResolvedValue({ deleted: [] })
		vi.spyOn(fs.promises, "rm").mockResolvedValue()

		const result = await runDumpJob(env, { storage: buildInjectableStorage() })

		expect(result).toEqual({ status: "failed", reason: "upload boom" })
		expect(
			runCalls.some((sql) => /DROP\s+SCHEMA\s+IF\s+EXISTS\s+public_dump\s+CASCADE/i.test(sql))
		).toBe(true)
	})

	it("runs tempfile cleanup in finally with the expected path", async () => {
		const { env } = createRunDumpJobEnv({ dumpsEnabled: true, hasB2: true })
		vi.spyOn(dump, "materializeDumpSchema").mockResolvedValue()
		vi.spyOn(dump, "runPgDump").mockResolvedValue()
		vi.spyOn(dump, "verifyDump").mockResolvedValue({ sha256: "abc", bytes: 1234 })
		vi.spyOn(dump, "buildManifest").mockResolvedValue({} as unknown as DumpManifest)
		vi.spyOn(dump, "uploadDump").mockResolvedValue()
		vi.spyOn(dump, "pruneOldDumps").mockResolvedValue({ deleted: [] })
		const rmSpy = vi.spyOn(fs.promises, "rm").mockResolvedValue()

		const now = new Date("2026-05-29T00:00:00.000Z")
		await runDumpJob(env, {
			storage: buildInjectableStorage(),
			now,
			tmpDir: "/var/tmp",
		})

		expect(rmSpy).toHaveBeenCalledWith("/var/tmp/unison-2026-05-29.dump", { force: true })
	})

	it("fails before materializing the schema when DATABASE_URL is unset", async () => {
		const { env } = createRunDumpJobEnv({ dumpsEnabled: true, hasB2: true })
		process.env.DATABASE_URL = ""
		const materializeSpy = vi.spyOn(dump, "materializeDumpSchema").mockResolvedValue()
		vi.spyOn(fs.promises, "rm").mockResolvedValue()

		const result = await runDumpJob(env, { storage: buildInjectableStorage() })

		expect(result.status).toBe("failed")
		expect(materializeSpy).not.toHaveBeenCalled()
	})

	it("does not rethrow on pipeline failure; resolves with status failed", async () => {
		const { env } = createRunDumpJobEnv({ dumpsEnabled: true, hasB2: true })
		vi.spyOn(dump, "materializeDumpSchema").mockRejectedValueOnce(new Error("boom"))
		vi.spyOn(fs.promises, "rm").mockResolvedValue()

		const result = await runDumpJob(env, { storage: buildInjectableStorage() })

		expect(result).toEqual({ status: "failed", reason: "boom" })
	})
})
