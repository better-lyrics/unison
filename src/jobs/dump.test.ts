import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { EventEmitter } from "node:events"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { config } from "@/config"
import type { Env } from "@/types"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	buildManifest,
	LYRICS_KEEP_COLUMNS,
	materializeDumpSchema,
	REQUEST_KEEP_COLUMNS,
	runPgDump,
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
		expect(manifest.format).toBe("pg_dump custom (-Fc), Postgres 16")
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
