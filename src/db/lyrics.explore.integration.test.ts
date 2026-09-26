import { config } from "@/config"
import { Logger } from "@/infra/logger"
import {
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
	seedUser,
	wipeRevisionData,
} from "@/test/integration-harness"
import { epsilonForTier, hashBucket } from "@/utils/exploration"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { findByVideoId, softDeleteLyrics, submitLyrics } from "./lyrics"

const VIDEO_ID = "_ESLe5Ub0IE"
const LOW_EPS = epsilonForTier("low")

function keyWhere(prefix: string, inExplore: boolean): string {
	for (let i = 0; i < 10_000; i++) {
		const key = `${prefix}-${i}`
		if (hashBucket(key, VIDEO_ID) < LOW_EPS === inExplore) return key
	}
	throw new Error(`no ${inExplore ? "explore" : "control"} key found for ${prefix}`)
}

describeIntegration("findByVideoId submitter self-serve (integration)", () => {
	let db: IntegrationDb
	let seq = 0

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await db.pool.end()
	})

	beforeEach(() => wipeRevisionData(db))

	afterEach(() => {
		vi.restoreAllMocks()
	})

	async function submit(submitterId: number): Promise<number> {
		seq++
		const result = await submitLyrics(
			db.env,
			{
				videoId: VIDEO_ID,
				song: "Song",
				artist: "Artist",
				duration: 200,
				lyrics: `variant ${seq} first line\nvariant ${seq} second line`,
				format: "plain",
				syncType: "plain",
				language: "en",
			},
			submitterId
		)
		if (!result.created) throw new Error("seed lyric was not created")
		return result.id
	}

	async function rank(id: number, effectiveScore: number, voteCount = 1): Promise<void> {
		await db.pool.query(
			"UPDATE lyrics SET effective_score = $2, vote_count = $3, upvotes = $3 WHERE id = $1",
			[id, effectiveScore, voteCount]
		)
	}

	async function autoHide(id: number): Promise<void> {
		const votes = config.moderation.autoHide.minVotes
		await db.pool.query(
			"UPDATE lyrics SET vote_count = $2, downvotes = $2, upvotes = 0, effective_score = -1 WHERE id = $1",
			[id, votes]
		)
	}

	async function seedContest() {
		const primaryKey = keyWhere("primary", true)
		const challengerKey = keyWhere("challenger", true)
		const primaryId = await submit(await seedUser(db, primaryKey))
		const challengerId = await submit(await seedUser(db, challengerKey))
		await rank(primaryId, 3, 3)
		return { primaryKey, challengerKey, primaryId, challengerId }
	}

	function exploreServes(spy: ReturnType<typeof vi.spyOn>): number {
		return spy.mock.calls.filter(([message]) => message === "explore.serve").length
	}

	it("preconditions: the contest is on the low tier with a challenger in the pool", async () => {
		const { primaryId, challengerId } = await seedContest()

		const anon = await findByVideoId(db.env, VIDEO_ID)
		const explorer = await findByVideoId(db.env, VIDEO_ID, keyWhere("bystander", true))

		expect(anon?.id).toBe(primaryId)
		expect(anon?.confidence).toBe("low")
		expect(explorer?.id).toBe(challengerId)
	})

	it("serves the submitter their own primary even when their bucket is under epsilon", async () => {
		const { primaryKey, primaryId } = await seedContest()
		expect(hashBucket(primaryKey, VIDEO_ID)).toBeLessThan(LOW_EPS)

		const served = await findByVideoId(db.env, VIDEO_ID, primaryKey)

		expect(served?.id).toBe(primaryId)
	})

	it("serves a challenger's submitter their own sync instead of the primary", async () => {
		const { primaryId } = await seedContest()
		const ownerKey = keyWhere("owner", false)
		const ownId = await submit(await seedUser(db, ownerKey))

		const served = await findByVideoId(db.env, VIDEO_ID, ownerKey)

		expect(served?.id).toBe(ownId)
		expect(served?.id).not.toBe(primaryId)
	})

	it("serves an in-bucket challenger's submitter their own sync, never a rival challenger", async () => {
		await seedContest()
		const ownerKey = keyWhere("owner", true)
		const ownId = await submit(await seedUser(db, ownerKey))
		for (let i = 0; i < 4; i++) await submit(await seedUser(db, `rival-${i}`))

		const served = await findByVideoId(db.env, VIDEO_ID, ownerKey)

		expect(served?.id).toBe(ownId)
	})

	it("serves the submitter their own variant when it reaches this video through a link", async () => {
		await seedContest()
		const ownerKey = keyWhere("owner", true)
		const linked = await submitLyrics(
			db.env,
			{
				videoId: "dQw4w9WgXcQ",
				song: "Song",
				artist: "Artist",
				duration: 200,
				lyrics: "linked variant line one\nlinked variant line two",
				format: "plain",
				syncType: "plain",
				language: "en",
			},
			await seedUser(db, ownerKey)
		)
		await db.pool.query("INSERT INTO lyrics_video_ids (lyrics_id, video_id) VALUES ($1, $2)", [
			linked.id,
			VIDEO_ID,
		])

		const served = await findByVideoId(db.env, VIDEO_ID, ownerKey)

		expect(served?.id).toBe(linked.id)
	})

	it("serves the submitter their own sync while the exploration kill-switch is off", async () => {
		await seedContest()
		const ownerKey = keyWhere("owner", false)
		const ownId = await submit(await seedUser(db, ownerKey))
		const exploration = config.exploration as { enabled: boolean }
		exploration.enabled = false
		try {
			expect((await findByVideoId(db.env, VIDEO_ID, ownerKey))?.id).toBe(ownId)
		} finally {
			exploration.enabled = true
		}
	})

	it("does not log explore.serve on the self-serve path", async () => {
		const { primaryKey } = await seedContest()
		const info = vi.spyOn(Logger.prototype, "info")

		await findByVideoId(db.env, VIDEO_ID, primaryKey)

		expect(exploreServes(info)).toBe(0)
	})

	it("serves the best-ranked of several variants the submitter owns", async () => {
		await seedContest()
		const ownerKey = keyWhere("owner", true)
		const ownerId = await seedUser(db, ownerKey)
		const weaker = await submit(ownerId)
		const stronger = await submit(ownerId)
		await rank(weaker, 0.2)
		await rank(stronger, 1.5, 2)

		const served = await findByVideoId(db.env, VIDEO_ID, ownerKey)

		expect(served?.id).toBe(stronger)
	})

	it("skips the submitter's hidden variant for their best visible one", async () => {
		await seedContest()
		const ownerKey = keyWhere("owner", false)
		const ownerId = await seedUser(db, ownerKey)
		const hidden = await submit(ownerId)
		const visible = await submit(ownerId)
		await autoHide(hidden)

		const served = await findByVideoId(db.env, VIDEO_ID, ownerKey)

		expect(served?.id).toBe(visible)
	})

	describe("fall-through to normal behavior", () => {
		it("an in-bucket submitter whose only variant is auto-hidden gets explored like anyone", async () => {
			const { challengerId } = await seedContest()
			const ownerKey = keyWhere("owner", true)
			const hidden = await submit(await seedUser(db, ownerKey))
			await autoHide(hidden)
			const info = vi.spyOn(Logger.prototype, "info")

			const served = await findByVideoId(db.env, VIDEO_ID, ownerKey)

			expect(served?.id).toBe(challengerId)
			expect(exploreServes(info)).toBe(1)
		})

		it("an out-of-bucket submitter whose only variant is auto-hidden gets the primary", async () => {
			const { primaryId } = await seedContest()
			const ownerKey = keyWhere("owner", false)
			await autoHide(await submit(await seedUser(db, ownerKey)))

			const served = await findByVideoId(db.env, VIDEO_ID, ownerKey)

			expect(served?.id).toBe(primaryId)
		})

		it("a submitter whose only variant is deleted gets the primary", async () => {
			const { primaryId } = await seedContest()
			const ownerKey = keyWhere("owner", false)
			const ownerId = await seedUser(db, ownerKey)
			const deleted = await softDeleteLyrics(db.env, await submit(ownerId), ownerId, "submitter")
			expect(deleted.deleted).toBe(true)

			const served = await findByVideoId(db.env, VIDEO_ID, ownerKey)

			expect(served?.id).toBe(primaryId)
		})

		it("a submitter of a different video is explored on this one", async () => {
			const { challengerId } = await seedContest()
			const ownerKey = keyWhere("elsewhere", true)
			const ownerId = await seedUser(db, ownerKey)
			await submitLyrics(
				db.env,
				{
					videoId: "dQw4w9WgXcQ",
					song: "Other",
					artist: "Other",
					duration: 200,
					lyrics: "other video line one\nother video line two",
					format: "plain",
					syncType: "plain",
					language: "en",
				},
				ownerId
			)

			const served = await findByVideoId(db.env, VIDEO_ID, ownerKey)

			expect(served?.id).toBe(challengerId)
		})
	})

	describe("non-submitters are unchanged", () => {
		it("an in-bucket non-submitter is served a challenger and logs explore.serve", async () => {
			const { challengerId } = await seedContest()
			const info = vi.spyOn(Logger.prototype, "info")

			const served = await findByVideoId(db.env, VIDEO_ID, keyWhere("bystander", true))

			expect(served?.id).toBe(challengerId)
			expect(exploreServes(info)).toBe(1)
		})

		it("an out-of-bucket non-submitter is served the primary", async () => {
			const { primaryId } = await seedContest()

			const served = await findByVideoId(db.env, VIDEO_ID, keyWhere("bystander", false))

			expect(served?.id).toBe(primaryId)
		})

		it("an anonymous request is served the primary", async () => {
			const { primaryId } = await seedContest()

			const served = await findByVideoId(db.env, VIDEO_ID)

			expect(served?.id).toBe(primaryId)
		})
	})

	describe("invariants", () => {
		it("self-serving does not overwrite the cached primary for everyone else", async () => {
			const { primaryId } = await seedContest()
			const ownerKey = keyWhere("owner", false)
			const ownId = await submit(await seedUser(db, ownerKey))

			expect((await findByVideoId(db.env, VIDEO_ID, ownerKey))?.id).toBe(ownId)
			expect((await findByVideoId(db.env, VIDEO_ID))?.id).toBe(primaryId)
			expect((await findByVideoId(db.env, VIDEO_ID, ownerKey))?.id).toBe(ownId)
		})

		it("returns null for an unknown video even when the key has submissions elsewhere", async () => {
			const { primaryKey } = await seedContest()

			expect(await findByVideoId(db.env, "missingVid0", primaryKey)).toBeNull()
		})
	})
})
