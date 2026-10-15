import { getGlobalFeed, getPersonalizedFeed } from "@/db/feed"
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

const LRC = readRevisionFixture("amazing-grace.lrc")

describeIntegration("feeds with council flags (integration)", () => {
	let db: IntegrationDb
	let submitter: number
	let flagged: number
	let clean: number

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await wipeRevisionData(db)
		await db.pool.end()
	})

	beforeEach(async () => {
		await wipeRevisionData(db)
		submitter = await seedUser(db, "c1".repeat(32))
		flagged = await seedLyric(db, submitter, { lyrics: LRC, format: "lrc", videoId: "LZTOfQiudx0" })
		clean = await seedLyric(db, submitter, { lyrics: LRC, format: "lrc", videoId: "dQw4w9WgXcQ" })
		await db.pool.query("UPDATE lyrics SET effective_score = 2 WHERE id = ANY($1)", [
			[flagged, clean],
		])
		await db.pool.query("INSERT INTO report_cases (lyrics_id) VALUES ($1)", [flagged])
		db.cache.store.clear()
	})

	const keep = async () => {
		await db.pool.query(
			"UPDATE report_cases SET status = 'kept', decided_at = EXTRACT(EPOCH FROM NOW())::INTEGER WHERE lyrics_id = $1",
			[flagged]
		)
		db.cache.store.clear()
	}

	const ids = (items: { id: number }[]) => items.map((i) => Number(i.id)).sort()

	describe("global feed", () => {
		it("hides a positively scored lyric while its flag is open", async () => {
			expect(ids(await getGlobalFeed(db.env, 20))).toEqual([clean])
		})

		it("shows it again once the council keeps it", async () => {
			await keep()
			expect(ids(await getGlobalFeed(db.env, 20))).toEqual([clean, flagged].sort())
		})
	})

	describe("personalized feed", () => {
		it("hides a positively scored lyric while its flag is open", async () => {
			expect(ids(await getPersonalizedFeed(db.env, submitter, 20))).toEqual([clean])
		})

		it("shows it again once the council keeps it", async () => {
			await keep()
			expect(ids(await getPersonalizedFeed(db.env, submitter, 20))).toEqual([clean, flagged].sort())
		})
	})
})
