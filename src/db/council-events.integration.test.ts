import {
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
	seedLyric,
	seedUser,
	wipeRevisionData,
} from "@/test/integration-harness"
import { readRevisionFixture } from "@/test/lyric-fixtures"
import { generatePetName } from "@/utils/petname"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { listCouncilEvents, recordCouncilEvent } from "./council-events"
import { resolvePeople } from "./users"

const ACTOR_KEY = "a1".repeat(32)
const OTHER_KEY = "b2".repeat(32)
const SUBMITTER_KEY = "c3".repeat(32)
const LRC = readRevisionFixture("amazing-grace.lrc")

describeIntegration("council event log (integration)", () => {
	let db: IntegrationDb
	let actor: number
	let other: number
	let lyricId: number

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await wipeRevisionData(db)
		await db.pool.end()
	})

	beforeEach(async () => {
		await wipeRevisionData(db)
		actor = await seedUser(db, ACTOR_KEY)
		other = await seedUser(db, OTHER_KEY)
		const submitter = await seedUser(db, SUBMITTER_KEY)
		lyricId = await seedLyric(db, submitter, { lyrics: LRC, format: "lrc" })
	})

	const list = (opts: Partial<Parameters<typeof listCouncilEvents>[1]> = {}) =>
		listCouncilEvents(db.env, { includeBookmarks: false, limit: 50, ...opts })

	async function seedBoost(boosterId: number): Promise<number> {
		const { rows } = await db.pool.query<{ id: number }>(
			"INSERT INTO boosts (booster_id, lyrics_id) VALUES ($1, $2) RETURNING id",
			[boosterId, lyricId]
		)
		return rows[0].id
	}

	describe("happy paths", () => {
		it("records an event and lists it with actor, lyric and note", async () => {
			await db.pool.query("UPDATE users SET nickname = 'Mira' WHERE id = $1", [actor])
			await recordCouncilEvent(db.env.DB, {
				actorId: actor,
				kind: "reject",
				source: "web",
				lyricsId: lyricId,
				refId: 1,
				note: "Chorus timing lands early on every repeat.",
			})
			const { events, nextCursor } = await list()
			expect(nextCursor).toBeNull()
			expect(events).toHaveLength(1)
			expect(events[0]).toMatchObject({
				kind: "reject",
				source: "web",
				note: "Chorus timing lands early on every repeat.",
				undone: false,
				actor: { keyId: ACTOR_KEY, displayName: "Mira" },
				subject: null,
				lyric: {
					id: lyricId,
					videoId: "HsBfV2A5dUY",
					song: "Amazing Grace",
					artist: "Traditional",
				},
			})
		})

		it("lists by event time, newest first, even when backfilled out of order", async () => {
			await recordCouncilEvent(db.env.DB, {
				actorId: actor,
				kind: "reject",
				source: "web",
				refId: 1,
				at: 100,
			})
			await recordCouncilEvent(db.env.DB, {
				actorId: actor,
				kind: "reject",
				source: "web",
				refId: 2,
				at: 300,
			})
			await recordCouncilEvent(db.env.DB, {
				actorId: actor,
				kind: "reject",
				source: "web",
				refId: 3,
				at: 200,
			})
			const { events } = await list()
			expect(events.map((e) => e.at)).toEqual([300, 200, 100])
		})

		it("pages across events that share a timestamp", async () => {
			for (let i = 1; i <= 3; i++) {
				await recordCouncilEvent(db.env.DB, {
					actorId: actor,
					kind: "reject",
					source: "web",
					refId: i,
					at: 500,
				})
			}
			const first = await list({ limit: 2 })
			const second = await list({ limit: 2, cursor: first.nextCursor ?? undefined })
			expect([...first.events, ...second.events].map((e) => e.id).sort()).toHaveLength(3)
			expect(second.nextCursor).toBeNull()
		})

		it("pages with a cursor", async () => {
			for (let i = 1; i <= 5; i++) {
				await recordCouncilEvent(db.env.DB, {
					actorId: actor,
					kind: "reject",
					source: "web",
					refId: i,
				})
			}
			const first = await list({ limit: 2 })
			expect(first.events).toHaveLength(2)
			expect(first.nextCursor).not.toBeNull()
			const second = await list({ limit: 2, cursor: first.nextCursor ?? undefined })
			const third = await list({ limit: 2, cursor: second.nextCursor ?? undefined })
			expect(third.nextCursor).toBeNull()
			const ids = [...first.events, ...second.events, ...third.events].map((e) => e.id)
			expect(new Set(ids).size).toBe(5)
		})

		it("filters by kinds, actor and lyric", async () => {
			await recordCouncilEvent(db.env.DB, {
				actorId: actor,
				kind: "seal",
				source: "web",
				lyricsId: lyricId,
				refId: 1,
			})
			await recordCouncilEvent(db.env.DB, {
				actorId: other,
				kind: "reject",
				source: "discord",
				refId: 2,
			})
			await recordCouncilEvent(db.env.DB, {
				actorId: other,
				kind: "member_add",
				source: "admin",
				subjectUserId: actor,
			})
			expect((await list({ kinds: ["seal", "unseal"] })).events.map((e) => e.kind)).toEqual([
				"seal",
			])
			expect((await list({ actorKeyId: OTHER_KEY })).events).toHaveLength(2)
			expect((await list({ lyricsId: lyricId })).events.map((e) => e.kind)).toEqual(["seal"])
			const member = (await list({ kinds: ["member_add"] })).events[0]
			expect(member.subject?.keyId).toBe(ACTOR_KEY)
			expect(member.lyric).toBeNull()
		})
	})

	describe("edge cases", () => {
		it("hides bookmark events unless asked", async () => {
			await recordCouncilEvent(db.env.DB, {
				actorId: actor,
				kind: "bookmark",
				source: "web",
				lyricsId: lyricId,
				refId: 9,
			})
			await recordCouncilEvent(db.env.DB, {
				actorId: actor,
				kind: "release",
				source: "web",
				lyricsId: lyricId,
				refId: 9,
			})
			expect((await list()).events).toHaveLength(0)
			expect((await list({ includeBookmarks: true })).events.map((e) => e.kind)).toEqual([
				"release",
				"bookmark",
			])
		})

		it("renders an admin action without an actor", async () => {
			await recordCouncilEvent(db.env.DB, {
				actorId: null,
				kind: "unseal",
				source: "admin",
				lyricsId: lyricId,
				refId: 4,
			})
			const { events } = await list()
			expect(events[0].actor).toBeNull()
			expect(events[0].source).toBe("admin")
		})

		it("falls back to the pet name for an actor without a nickname", async () => {
			await recordCouncilEvent(db.env.DB, {
				actorId: other,
				kind: "reject",
				source: "web",
				refId: 5,
			})
			expect((await list()).events[0].actor?.displayName).toBe(generatePetName(OTHER_KEY))
		})

		it("round-trips unicode notes", async () => {
			const note = "Refrão fora de tempo 🎵 サビのタイミング"
			await recordCouncilEvent(db.env.DB, {
				actorId: actor,
				kind: "reject",
				source: "web",
				refId: 6,
				note,
			})
			expect((await list()).events[0].note).toBe(note)
		})

		it("returns an empty page for an empty log", async () => {
			expect(await list()).toEqual({ events: [], nextCursor: null })
		})
	})

	describe("invariants", () => {
		it("ignores a second decision event for the same reference", async () => {
			await recordCouncilEvent(db.env.DB, {
				actorId: actor,
				kind: "seal",
				source: "web",
				lyricsId: lyricId,
				refId: 11,
			})
			await recordCouncilEvent(db.env.DB, {
				actorId: other,
				kind: "seal",
				source: "discord",
				lyricsId: lyricId,
				refId: 11,
			})
			const { events } = await list()
			expect(events).toHaveLength(1)
			expect(events[0].actor?.keyId).toBe(ACTOR_KEY)
		})

		it("derives undone from the revoked boost or rejection", async () => {
			const boostId = await seedBoost(actor)
			await recordCouncilEvent(db.env.DB, {
				actorId: actor,
				kind: "seal",
				source: "web",
				lyricsId: lyricId,
				refId: boostId,
			})
			const { rows } = await db.pool.query<{ id: number }>(
				"INSERT INTO rejections (lyrics_id, rejected_by, rejected_at) VALUES ($1, $2, 1) RETURNING id",
				[lyricId, other]
			)
			await recordCouncilEvent(db.env.DB, {
				actorId: other,
				kind: "reject",
				source: "web",
				lyricsId: lyricId,
				refId: rows[0].id,
			})
			expect((await list()).events.map((e) => e.undone)).toEqual([false, false])
			await db.pool.query("UPDATE boosts SET revoked_at = 2 WHERE id = $1", [boostId])
			await db.pool.query("UPDATE rejections SET revoked_at = 2 WHERE id = $1", [rows[0].id])
			expect((await list()).events.map((e) => e.undone)).toEqual([true, true])
		})

		it("drops a lyric's events when the lyric row is deleted", async () => {
			await recordCouncilEvent(db.env.DB, {
				actorId: actor,
				kind: "reject",
				source: "web",
				lyricsId: lyricId,
				refId: 12,
			})
			await db.pool.query("DELETE FROM lyrics WHERE id = $1", [lyricId])
			expect((await list()).events).toHaveLength(0)
		})
	})

	describe("resolvePeople", () => {
		it("resolves identities for many users in one call", async () => {
			await db.pool.query("UPDATE users SET nickname = 'Mira' WHERE id = $1", [actor])
			const people = await resolvePeople(db.env, [actor, other, actor])
			expect(people.size).toBe(2)
			expect(people.get(actor)).toMatchObject({
				userId: actor,
				keyId: ACTOR_KEY,
				displayName: "Mira",
				handle: "mira",
			})
			expect(people.get(other)).toMatchObject({
				keyId: OTHER_KEY,
				displayName: generatePetName(OTHER_KEY),
				handle: null,
			})
		})

		it("returns an empty map for no ids", async () => {
			expect((await resolvePeople(db.env, [])).size).toBe(0)
		})
	})
})
