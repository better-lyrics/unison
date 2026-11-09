import { spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { D1Compat } from "@/infra/database"
import { materializeDumpSchema, runPgDump } from "@/jobs/dump"
import { wipeCouncilTables } from "@/test/integration-harness"
import type { Env } from "@/types"
import { generatePetName } from "@/utils/petname"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const { Pool } = pg

const NAMED_KEY = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90"
const UNNAMED_KEY = "5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d"
const IDLE_KEY = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0"

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

describeIntegration("dump pipeline (integration)", () => {
	const sourceUrl = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
	const restoreUrl = process.env.INTEGRATION_RESTORE_URL
	let sourcePool: pg.Pool
	let restorePool: pg.Pool
	let tmp: string
	let dumpPath: string

	beforeAll(async () => {
		if (!sourceUrl || !restoreUrl) {
			throw new Error("INTEGRATION_DATABASE_URL and INTEGRATION_RESTORE_URL are required")
		}
		sourcePool = new Pool({ connectionString: sourceUrl })
		restorePool = new Pool({ connectionString: restoreUrl })
		tmp = await mkdtemp(join(tmpdir(), "dump-integ-"))
		dumpPath = join(tmp, "test.dump")

		await sourcePool.query("DELETE FROM boosts")
		await sourcePool.query("DELETE FROM badge_awards")
		await sourcePool.query("DELETE FROM committee_members")
		await sourcePool.query("DELETE FROM contribution_events")
		await sourcePool.query("DELETE FROM lyrics_requests")
		await sourcePool.query("DELETE FROM requested_songs")
		await sourcePool.query("DELETE FROM votes")
		await sourcePool.query("DELETE FROM reports")
		await sourcePool.query("DELETE FROM lyrics")
		await wipeCouncilTables(sourcePool)
		await sourcePool.query("DELETE FROM users")
		await sourcePool.query("DELETE FROM public_keys")

		await sourcePool.query(`
			INSERT INTO public_keys (key_id, public_key) VALUES
				('${NAMED_KEY}', 'pubkey-a'), ('${UNNAMED_KEY}', 'pubkey-b'), ('${IDLE_KEY}', 'pubkey-c')
		`)
		await sourcePool.query(`
			INSERT INTO users (id, key_id, nickname) VALUES
				(1, '${NAMED_KEY}', 'Moonlit'), (2, '${UNNAMED_KEY}', NULL), (3, '${IDLE_KEY}', 'Lurker')
		`)
		await sourcePool.query(`
			INSERT INTO lyrics (id, video_id, song, artist, duration, song_norm, artist_norm, lyrics, format, submitter_id)
			VALUES
				(1, 'abc123', 'Song A', 'Artist A', 180, 'song a', 'artist a', 'gzipped-base64', 'lrc', 1),
				(2, 'def456', 'Song B', 'Artist B', 200, 'song b', 'artist b', 'gzipped-base64', 'plain', 1),
				(3, 'ghi789', 'Song C', 'Artist C', 210, 'song c', 'artist c', 'gzipped-base64', 'plain', 2)
		`)
		await sourcePool.query(`
			INSERT INTO requested_songs (video_id, song, artist) VALUES ('xyz789', 'Wanted', 'Someone')
		`)
		await sourcePool.query(`
			INSERT INTO lyrics_requests (video_id, requester_id, requester_type) VALUES ('xyz789', 'opaque-id', 'extension')
		`)

		await restorePool.query("DROP SCHEMA IF EXISTS public_dump CASCADE")
	})

	afterAll(async () => {
		if (sourcePool) await sourcePool.end()
		if (restorePool) await restorePool.end()
		if (tmp) await rm(tmp, { recursive: true, force: true })
	})

	it("dumps and restores public_dump with only sanitized content", async () => {
		const env = {
			DB: new D1Compat(sourcePool),
		} as unknown as Env

		await materializeDumpSchema(env)
		await runPgDump({ databaseUrl: sourceUrl!, outPath: dumpPath })

		await new Promise<void>((resolve, reject) => {
			const proc = spawn(
				"pg_restore",
				["-d", restoreUrl!, "--no-owner", "--no-privileges", dumpPath],
				{ stdio: ["ignore", "ignore", "pipe"] }
			)
			let stderr = ""
			proc.stderr.on("data", (c) => {
				stderr += c.toString()
			})
			proc.on("close", (code) => {
				if (code === 0) resolve()
				else reject(new Error(`pg_restore exit ${code}: ${stderr}`))
			})
		})

		const lyricsCount = await restorePool.query<{ count: string }>(
			"SELECT COUNT(*)::TEXT AS count FROM public_dump.lyrics"
		)
		expect(lyricsCount.rows[0].count).toBe("3")

		const credits = await restorePool.query(
			"SELECT id, submitter_key_id, url FROM public_dump.lyrics ORDER BY id"
		)
		expect(credits.rows).toEqual([
			{
				id: 1,
				submitter_key_id: NAMED_KEY,
				url: "https://unison.betterlyrics.org/song/abc123?variantId=1",
			},
			{
				id: 2,
				submitter_key_id: NAMED_KEY,
				url: "https://unison.betterlyrics.org/song/def456?variantId=2",
			},
			{
				id: 3,
				submitter_key_id: UNNAMED_KEY,
				url: "https://unison.betterlyrics.org/song/ghi789?variantId=3",
			},
		])

		const contributors = await restorePool.query(
			"SELECT key_id, display_name, profile_url FROM public_dump.contributors ORDER BY key_id"
		)
		expect(contributors.rows).toEqual([
			{
				key_id: UNNAMED_KEY,
				display_name: generatePetName(UNNAMED_KEY),
				profile_url: `https://unison.betterlyrics.org/curator/${UNNAMED_KEY}`,
			},
			{
				key_id: NAMED_KEY,
				display_name: "Moonlit",
				profile_url: `https://unison.betterlyrics.org/curator/${NAMED_KEY}`,
			},
		])

		const requestedCount = await restorePool.query<{ count: string }>(
			"SELECT COUNT(*)::TEXT AS count FROM public_dump.requested_songs"
		)
		expect(requestedCount.rows[0].count).toBe("1")

		const requestsCount = await restorePool.query<{ count: string }>(
			"SELECT COUNT(*)::TEXT AS count FROM public_dump.lyrics_requests"
		)
		expect(requestsCount.rows[0].count).toBe("1")

		const sensitiveTables = ["users", "votes", "reports", "public_keys"]
		for (const table of sensitiveTables) {
			const exists = await restorePool.query<{ exists: boolean }>(
				`SELECT EXISTS (
					SELECT 1 FROM information_schema.tables
					WHERE table_schema IN ('public', 'public_dump') AND table_name = $1
				) AS exists`,
				[table]
			)
			expect(exists.rows[0].exists, `table ${table} should NOT exist in restored DB`).toBe(false)
		}

		const droppedLyricsCols = [
			"submitter_id",
			"lyrics_text_search",
			"deleted_by_user_id",
			"deleted_by_role",
			"deletion_reason",
		]
		for (const col of droppedLyricsCols) {
			const exists = await restorePool.query<{ exists: boolean }>(
				`SELECT EXISTS (
					SELECT 1 FROM information_schema.columns
					WHERE table_schema = 'public_dump' AND table_name = 'lyrics' AND column_name = $1
				) AS exists`,
				[col]
			)
			expect(exists.rows[0].exists, `lyrics column ${col} should be absent`).toBe(false)
		}

		const requesterIdExists = await restorePool.query<{ exists: boolean }>(
			`SELECT EXISTS (
				SELECT 1 FROM information_schema.columns
				WHERE table_schema = 'public_dump' AND table_name = 'lyrics_requests' AND column_name = 'requester_id'
			) AS exists`
		)
		expect(requesterIdExists.rows[0].exists).toBe(false)
	}, 30_000)
})
