import { afterAll, beforeAll, beforeEach, expect, it } from "vitest"
import { artworkCacheKey } from "@/services/artwork"
import { getProfileExtras, setProfileSettings } from "@/db/profile-settings"
import {
	describeIntegration,
	type IntegrationDb,
	openIntegrationDb,
	seedLyric,
	seedUser,
	wipeRevisionData,
} from "@/test/integration-harness"

const KEY = "d".repeat(64)
const VIDEO = "HsBfV2A5dUY"
const LINK = { discord_id: "d1", key_id: KEY, discord_username: "alice", discord_avatar: null, linked_at: 1 }

describeIntegration("profile settings (integration)", () => {
	let db: IntegrationDb

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await db.pool.end()
	})

	beforeEach(async () => {
		await wipeRevisionData(db)
		await db.pool.query("DELETE FROM song_artwork")
	})

	it("serves a banner only while the curator still has a live lyric for it", async () => {
		const userId = await seedUser(db, KEY)
		const lyricId = await seedLyric(db, userId, { lyrics: "[00:01.00]Morning comes in grey", format: "lrc" })
		db.cache.store.set(artworkCacheKey(VIDEO), "https://lh3.googleusercontent.com/cover=w544-h544")

		expect(await setProfileSettings(db.env, KEY, { banner: VIDEO })).toEqual({
			banner: VIDEO,
			showDiscord: false,
		})
		expect((await getProfileExtras(db.env, KEY, null)).banner?.videoId).toBe(VIDEO)

		await db.pool.query(
			"UPDATE lyrics SET deleted_at = 1, deleted_by_user_id = $2, deleted_by_role = $3 WHERE id = $1",
			[lyricId, userId, "submitter"]
		)
		expect((await getProfileExtras(db.env, KEY, null)).banner).toBeUndefined()
	})

	it("changes only the field it is given", async () => {
		await seedUser(db, KEY)
		await setProfileSettings(db.env, KEY, { banner: VIDEO })
		expect(await setProfileSettings(db.env, KEY, { showDiscord: true })).toEqual({
			banner: VIDEO,
			showDiscord: true,
		})
		expect(await setProfileSettings(db.env, KEY, { banner: null })).toEqual({
			banner: null,
			showDiscord: true,
		})
		expect((await getProfileExtras(db.env, KEY, LINK)).discord).toEqual({ id: "d1", username: "alice" })
	})
})
