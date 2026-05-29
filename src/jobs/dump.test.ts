import { EventEmitter } from "node:events"
import type { Env } from "@/types"
import { describe, expect, it, vi } from "vitest"
import {
	LYRICS_KEEP_COLUMNS,
	materializeDumpSchema,
	REQUEST_KEEP_COLUMNS,
	runPgDump,
} from "@/jobs/dump"

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

function fakeSpawn(opts: FakeChildOptions) {
	return vi.fn(() => {
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
		return proc as unknown as ReturnType<typeof import("node:child_process").spawn>
	})
}

describe("runPgDump", () => {
	it("invokes pg_dump with the correct flags and connection string last", async () => {
		const spawnFn = fakeSpawn({ exitCode: 0 })
		await runPgDump({
			databaseUrl: "postgres://user:pw@host:5432/db",
			outPath: "/tmp/out.dump",
			spawnFn: spawnFn as unknown as typeof import("node:child_process").spawn,
		})
		expect(spawnFn).toHaveBeenCalledTimes(1)
		const call = spawnFn.mock.calls[0] as unknown as [string, string[]]
		const [bin, args] = call
		expect(bin).toBe("pg_dump")
		expect(args).toContain("-Fc")
		expect(args).toContain("--no-owner")
		expect(args).toContain("--no-privileges")
		expect(args).toContain("--schema=public_dump")
		const fIdx = args.indexOf("-f")
		expect(fIdx).toBeGreaterThanOrEqual(0)
		expect(args[fIdx + 1]).toBe("/tmp/out.dump")
		expect(args[args.length - 1]).toBe("postgres://user:pw@host:5432/db")
	})

	it("resolves on exit code 0", async () => {
		const spawnFn = fakeSpawn({ exitCode: 0 })
		await expect(
			runPgDump({
				databaseUrl: "postgres://localhost/db",
				outPath: "/tmp/out.dump",
				spawnFn: spawnFn as unknown as typeof import("node:child_process").spawn,
			})
		).resolves.toBeUndefined()
	})

	it("rejects with exit code and stderr on non-zero exit", async () => {
		const spawnFn = fakeSpawn({ exitCode: 1, stderr: "connection refused" })
		await expect(
			runPgDump({
				databaseUrl: "postgres://localhost/db",
				outPath: "/tmp/out.dump",
				spawnFn: spawnFn as unknown as typeof import("node:child_process").spawn,
			})
		).rejects.toThrow(/pg_dump exit 1.*connection refused/)
	})

	it("rejects when the child process emits an error event", async () => {
		const err = Object.assign(new Error("spawn pg_dump ENOENT"), { code: "ENOENT" })
		const spawnFn = fakeSpawn({ spawnError: err })
		await expect(
			runPgDump({
				databaseUrl: "postgres://localhost/db",
				outPath: "/tmp/out.dump",
				spawnFn: spawnFn as unknown as typeof import("node:child_process").spawn,
			})
		).rejects.toThrow(/ENOENT/)
	})
})
