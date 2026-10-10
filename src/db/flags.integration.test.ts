import { isUniqueViolation } from "@/infra/database"
import {
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
	seedLyric,
	seedUser,
	wipeRevisionData,
} from "@/test/integration-harness"
import { readRevisionFixture } from "@/test/lyric-fixtures"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

const VIDEO = "LZTOfQiudx0"
const LRC = readRevisionFixture("amazing-grace.lrc")
const kid = (n: number): string => n.toString(16).padStart(64, "0")

describeIntegration("council flags (integration)", () => {
	let db: IntegrationDb
	let submitter: number
	let lyricsId: number

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await wipeRevisionData(db)
		await db.pool.end()
	})

	beforeEach(async () => {
		await wipeRevisionData(db)
		submitter = await seedUser(db, kid(1))
		lyricsId = await seedLyric(db, submitter, { lyrics: LRC, format: "lrc", videoId: VIDEO })
	})

	describe("schema", () => {
		it("allows only one open case per lyric", async () => {
			await db.pool.query("INSERT INTO report_cases (lyrics_id) VALUES ($1)", [lyricsId])
			const second = db.pool.query("INSERT INTO report_cases (lyrics_id) VALUES ($1)", [lyricsId])
			await expect(second).rejects.toSatisfy(isUniqueViolation)
		})

		it("allows a new open case once the previous one is decided", async () => {
			await db.pool.query(
				"INSERT INTO report_cases (lyrics_id, status, decided_at) VALUES ($1, 'kept', 1)",
				[lyricsId]
			)
			await db.pool.query("INSERT INTO report_cases (lyrics_id) VALUES ($1)", [lyricsId])
			const { rows } = await db.pool.query(
				"SELECT status FROM report_cases WHERE lyrics_id = $1 ORDER BY id",
				[lyricsId]
			)
			expect(rows.map((r) => r.status)).toEqual(["kept", "open"])
		})

		it("accepts flag council event kinds", async () => {
			await db.pool.query(
				"INSERT INTO council_events (actor_id, kind, source, lyrics_id) VALUES ($1, 'flag_remove', 'web', $2), ($1, 'flag_keep', 'discord', $2)",
				[submitter, lyricsId]
			)
		})
	})
})
