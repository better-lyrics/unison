import { readFileSync } from "node:fs"
import { config } from "@/config"
import { D1Compat } from "@/infra/database"
import type { Env } from "@/types"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import {
	countVideoLinks,
	linkVideoForOwner,
	listVideoLinks,
	unlinkVideoForOwner,
} from "./video-links"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

const PRIMARY = "dQw4w9WgXcQ"
const TARGET = "9bZkp7q19f0"
const match = { getDuration: async () => 180 }

describeIntegration("video link service (integration)", () => {
	const url = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
	let pool: pg.Pool
	let env: Env
	let owner: number
	let stranger: number
	let lyricId: number

	beforeAll(async () => {
		if (!url) throw new Error("INTEGRATION_DATABASE_URL or DATABASE_URL is required")
		pool = new Pool({ connectionString: url })
		const schema = readFileSync(new URL("../../schema.sql", import.meta.url), "utf-8")
		await pool.query(schema)
		env = {
			DB: new D1Compat(pool),
			CACHE: { get: async () => null, put: async () => {}, delete: async () => {} },
		} as unknown as Env
	})

	afterAll(async () => {
		await pool.end()
	})

	async function seedUser(keyId: string): Promise<number> {
		const r = await pool.query("INSERT INTO users (key_id) VALUES ($1) RETURNING id", [keyId])
		return r.rows[0].id
	}

	async function seedLyric(videoId: string, submitterId: number, duration = 180): Promise<number> {
		const r = await pool.query(
			`INSERT INTO lyrics (video_id, song, artist, duration, song_norm, artist_norm, lyrics, format, sync_type, submitter_id)
			 VALUES ($1,'Song','Artist',$2,'song','artist','x','plain','plain',$3) RETURNING id`,
			[videoId, duration, submitterId]
		)
		const id = r.rows[0].id
		await pool.query("INSERT INTO lyrics_video_ids (lyrics_id, video_id) VALUES ($1, $2)", [
			id,
			videoId,
		])
		return id
	}

	beforeEach(async () => {
		await pool.query("DELETE FROM lyrics_video_ids")
		await pool.query("DELETE FROM lyrics")
		await pool.query("DELETE FROM users")
		owner = await seedUser("key-owner")
		stranger = await seedUser("key-stranger")
		lyricId = await seedLyric(PRIMARY, owner)
	})

	it("links a matching-duration video for the owner", async () => {
		const res = await linkVideoForOwner(env, lyricId, owner, TARGET, match)
		expect(res.ok).toBe(true)
		if (res.ok) {
			expect(res.videos.map((v) => v.videoId).sort()).toEqual([TARGET, PRIMARY].sort())
			expect(res.videos.find((v) => v.videoId === PRIMARY)?.isPrimary).toBe(true)
			expect(res.videos.find((v) => v.videoId === TARGET)?.isPrimary).toBe(false)
		}
	})

	it("lists the primary first and marks it", async () => {
		await linkVideoForOwner(env, lyricId, owner, TARGET, match)
		const links = await listVideoLinks(env, lyricId)
		expect(links[0]).toEqual({ videoId: PRIMARY, isPrimary: true })
	})

	describe("guardrails", () => {
		it("rejects a non-owner", async () => {
			const res = await linkVideoForOwner(env, lyricId, stranger, TARGET, match)
			expect(res).toEqual({ ok: false, reason: "not_owner" })
		})

		it("rejects a missing lyric", async () => {
			const res = await linkVideoForOwner(env, 999999, owner, TARGET, match)
			expect(res).toEqual({ ok: false, reason: "not_found" })
		})

		it("rejects an invalid video id length", async () => {
			const res = await linkVideoForOwner(env, lyricId, owner, "short", match)
			expect(res).toEqual({ ok: false, reason: "invalid_id" })
		})

		it("rejects an unverifiable video (duration unavailable)", async () => {
			const res = await linkVideoForOwner(env, lyricId, owner, TARGET, {
				getDuration: async () => null,
			})
			expect(res).toEqual({ ok: false, reason: "unverifiable" })
		})

		it("rejects a duration mismatch beyond the delta", async () => {
			const res = await linkVideoForOwner(env, lyricId, owner, TARGET, {
				getDuration: async () => 180 + config.videoLinking.durationDeltaSeconds + 1,
			})
			expect(res).toEqual({ ok: false, reason: "duration_mismatch" })
		})

		it("accepts a duration exactly at the delta boundary", async () => {
			const res = await linkVideoForOwner(env, lyricId, owner, TARGET, {
				getDuration: async () => 180 + config.videoLinking.durationDeltaSeconds,
			})
			expect(res.ok).toBe(true)
		})

		it("rejects when the per-variant cap is reached", async () => {
			for (let i = 0; i < config.videoLinking.maxVideosPerVariant - 1; i++) {
				await pool.query("INSERT INTO lyrics_video_ids (lyrics_id, video_id) VALUES ($1, $2)", [
					lyricId,
					`pad00000${String(i).padStart(3, "0")}`,
				])
			}
			expect(await countVideoLinks(env, lyricId)).toBe(config.videoLinking.maxVideosPerVariant)
			const res = await linkVideoForOwner(env, lyricId, owner, TARGET, match)
			expect(res).toEqual({ ok: false, reason: "cap_reached" })
		})
	})

	describe("idempotence", () => {
		it("linking the primary is a no-op success", async () => {
			const res = await linkVideoForOwner(env, lyricId, owner, PRIMARY, match)
			expect(res.ok).toBe(true)
			expect(await countVideoLinks(env, lyricId)).toBe(1)
		})

		it("linking an already-linked video does not duplicate", async () => {
			await linkVideoForOwner(env, lyricId, owner, TARGET, match)
			await linkVideoForOwner(env, lyricId, owner, TARGET, match)
			expect(await countVideoLinks(env, lyricId)).toBe(2)
		})
	})

	describe("unlink", () => {
		it("unlinks a non-primary video for the owner", async () => {
			await linkVideoForOwner(env, lyricId, owner, TARGET, match)
			const res = await unlinkVideoForOwner(env, lyricId, owner, TARGET)
			expect(res.ok).toBe(true)
			if (res.ok) expect(res.videos.map((v) => v.videoId)).toEqual([PRIMARY])
		})

		it("refuses to unlink the primary video", async () => {
			const res = await unlinkVideoForOwner(env, lyricId, owner, PRIMARY)
			expect(res).toEqual({ ok: false, reason: "cannot_unlink_primary" })
		})

		it("refuses a non-owner", async () => {
			await linkVideoForOwner(env, lyricId, owner, TARGET, match)
			const res = await unlinkVideoForOwner(env, lyricId, stranger, TARGET)
			expect(res).toEqual({ ok: false, reason: "not_owner" })
		})
	})
})
