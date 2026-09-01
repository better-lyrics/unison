import { readFileSync } from "node:fs"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { D1Compat } from "@/infra/database"
import type { Env } from "@/types"
import {
	computeMigrationPlan,
	createPreviewAudit,
	getAudit,
	markAuditCommitted,
	restoreFromSnapshot,
	runMigration,
} from "./account-migration"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

const OLD_KEY = `${"a".repeat(58)}oldkey`
const NEW_KEY = `${"b".repeat(58)}newkey`

describeIntegration("account migration (integration)", () => {
	const url = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
	let pool: pg.Pool
	let env: Env

	const one = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
		(await pool.query(sql, params)).rows[0] as T
	const num = async (sql: string, params: unknown[] = []): Promise<number> =>
		Number((await pool.query(sql, params)).rows[0].n)

	beforeAll(async () => {
		if (!url) throw new Error("INTEGRATION_DATABASE_URL or DATABASE_URL is required")
		pool = new Pool({ connectionString: url })
		const schema = readFileSync(new URL("../../schema.sql", import.meta.url), "utf-8")
		await pool.query(schema)
		env = { DB: new D1Compat(pool) } as unknown as Env
	})

	afterAll(async () => {
		await pool.end()
	})

	async function wipe() {
		await pool.query("DELETE FROM migration_requests")
		await pool.query("DELETE FROM request_fulfillments")
		await pool.query("DELETE FROM lyrics_requests")
		await pool.query("DELETE FROM requested_songs")
		await pool.query("DELETE FROM votes")
		await pool.query("DELETE FROM reports")
		await pool.query("DELETE FROM lyrics")
		await pool.query("DELETE FROM discord_links")
		await pool.query("DELETE FROM users")
		await pool.query("DELETE FROM public_keys")
	}

	async function insertLyric(submitterId: number, videoId: string): Promise<number> {
		const row = await one<{ id: number }>(
			`INSERT INTO lyrics (video_id, song, artist, duration, song_norm, artist_norm, lyrics, format, sync_type, submitter_id)
			 VALUES ($1, 'Song', 'Artist', 180, 'song', 'artist', 'gz', 'lrc', 'linesync', $2) RETURNING id`,
			[videoId, submitterId]
		)
		return row.id
	}

	beforeEach(wipe)

	it("merges the new user into the survivor and preserves totals", async () => {
		const OTHER_KEY = `${"c".repeat(58)}other0`
		await pool.query(
			"INSERT INTO public_keys (key_id, public_key) VALUES ($1, 'x'), ($2, 'y'), ($3, 'z')",
			[OLD_KEY, NEW_KEY, OTHER_KEY]
		)
		const oldUser = await one<{ id: number }>(
			"INSERT INTO users (key_id) VALUES ($1) RETURNING id",
			[OLD_KEY]
		)
		const newUser = await one<{ id: number }>(
			"INSERT INTO users (key_id) VALUES ($1) RETURNING id",
			[NEW_KEY]
		)
		const otherUser = await one<{ id: number }>(
			"INSERT INTO users (key_id) VALUES ($1) RETURNING id",
			[OTHER_KEY]
		)

		// old user submitted L1; new user submitted L2 and L3; a third party submitted L4
		const l1 = await insertLyric(oldUser.id, "vidL1")
		const l2 = await insertLyric(newUser.id, "vidL2")
		const l3 = await insertLyric(newUser.id, "vidL3")
		const l4 = await insertLyric(otherUser.id, "vidL4")

		// both voted on L1 (collision); new also voted on L2/L3 (self) and L4 (not self)
		await pool.query("INSERT INTO votes (lyrics_id, user_id, vote, is_self_vote) VALUES ($1,$2,1,0)", [
			l1,
			oldUser.id,
		])
		await pool.query("INSERT INTO votes (lyrics_id, user_id, vote, is_self_vote) VALUES ($1,$2,-1,0)", [
			l1,
			newUser.id,
		])
		await pool.query("INSERT INTO votes (lyrics_id, user_id, vote, is_self_vote) VALUES ($1,$2,1,1)", [
			l2,
			newUser.id,
		])
		await pool.query("INSERT INTO votes (lyrics_id, user_id, vote, is_self_vote) VALUES ($1,$2,1,0)", [
			l3,
			newUser.id,
		])
		await pool.query("INSERT INTO votes (lyrics_id, user_id, vote, is_self_vote) VALUES ($1,$2,1,0)", [
			l4,
			newUser.id,
		])

		// both reported L1 (collision)
		await pool.query(
			"INSERT INTO reports (lyrics_id, user_id, reason) VALUES ($1,$2,'spam'),($3,$4,'other')",
			[l1, oldUser.id, l1, newUser.id]
		)

		// a fulfillment credited to the new user
		await pool.query(
			"INSERT INTO request_fulfillments (video_id, lyrics_id, submitter_id, demand_snapshot, request_count_snapshot) VALUES ($1,$2,$3,1.0,1)",
			["vidL2", l2, newUser.id]
		)

		// extension requests: both keys requested vidR (collision), new also requested vidR2
		await pool.query(
			"INSERT INTO requested_songs (video_id, song, artist) VALUES ('vidR','s','a'),('vidR2','s','a')"
		)
		await pool.query(
			"INSERT INTO lyrics_requests (video_id, requester_id, requester_type) VALUES ('vidR',$1,'extension'),('vidR',$2,'extension'),('vidR2',$2,'extension')",
			[OLD_KEY, NEW_KEY]
		)

		// discord link on the old key only
		await pool.query(
			"INSERT INTO discord_links (discord_id, key_id, discord_username) VALUES ('disc-1', $1, 'alice')",
			[OLD_KEY]
		)

		const plan = await computeMigrationPlan(env, OLD_KEY, NEW_KEY)
		if ("error" in plan) throw new Error(plan.error)
		expect(plan.counts).toEqual({
			submissions: 2,
			votes: 4,
			reports: 1,
			fulfillments: 1,
			collisions: 3, // 1 vote + 1 report + 1 request
		})

		const auditId = await createPreviewAudit(env, {
			sessionId: "sess-1",
			discordId: "disc-1",
			oldKey: OLD_KEY,
			newKey: NEW_KEY,
			counts: plan.counts,
		})
		const result = await runMigration(env, { oldKey: OLD_KEY, newKey: NEW_KEY })
		if ("error" in result) throw new Error(result.error)
		await markAuditCommitted(env, auditId, result.moved, result.snapshot)

		expect(result.moved).toEqual({
			submissions: 2,
			votes: 4,
			reports: 1,
			fulfillments: 1,
			collisionsDropped: 3,
		})

		// invariants (mirrors scripts/local/migrate-account.cjs)
		expect(await num("SELECT count(*)::int n FROM lyrics WHERE submitter_id = $1", [oldUser.id])).toBe(3)
		expect(await num("SELECT count(*)::int n FROM votes WHERE user_id = $1", [oldUser.id])).toBe(4) // 1+4-1
		expect(await num("SELECT count(*)::int n FROM reports WHERE user_id = $1", [oldUser.id])).toBe(1) // 1+1-1
		expect(await num("SELECT count(*)::int n FROM users WHERE key_id = $1", [OLD_KEY])).toBe(0)
		expect(await num("SELECT count(*)::int n FROM users WHERE key_id = $1", [NEW_KEY])).toBe(1)
		expect(await num("SELECT count(*)::int n FROM users WHERE id = $1", [newUser.id])).toBe(0)
		const survivor = await one<{ key_id: string; vote_count: number }>(
			"SELECT key_id, vote_count FROM users WHERE id = $1",
			[oldUser.id]
		)
		expect(survivor.key_id).toBe(NEW_KEY)
		expect(survivor.vote_count).toBe(4)
		// is_self_vote recomputed from the merged submitter/voter relationship:
		// L1/L2/L3 are the survivor's own submissions (self), L4 is the third party's (not self)
		expect(
			await num(
				"SELECT count(*)::int n FROM votes WHERE user_id = $1 AND is_self_vote = 1",
				[oldUser.id]
			)
		).toBe(3)
		expect(
			await num(
				"SELECT count(*)::int n FROM votes WHERE user_id = $1 AND is_self_vote = 0",
				[oldUser.id]
			)
		).toBe(1)
		// discord link followed to the new key
		expect(await num("SELECT count(*)::int n FROM discord_links WHERE key_id = $1", [NEW_KEY])).toBe(1)
		// extension requests deduped and relabelled
		expect(
			await num("SELECT count(*)::int n FROM lyrics_requests WHERE requester_id = $1", [NEW_KEY])
		).toBe(2)
		expect(
			await num("SELECT count(*)::int n FROM lyrics_requests WHERE requester_id = $1", [OLD_KEY])
		).toBe(0)
	})

	it("restores the exact pre-image after a committed migration", async () => {
		await pool.query("INSERT INTO public_keys (key_id, public_key) VALUES ($1, 'x'), ($2, 'y')", [
			OLD_KEY,
			NEW_KEY,
		])
		const oldUser = await one<{ id: number }>(
			"INSERT INTO users (key_id, reputation) VALUES ($1, 1.3) RETURNING id",
			[OLD_KEY]
		)
		const newUser = await one<{ id: number }>(
			"INSERT INTO users (key_id, reputation) VALUES ($1, 0.9) RETURNING id",
			[NEW_KEY]
		)
		const l1 = await insertLyric(oldUser.id, "vidL1")
		const l2 = await insertLyric(newUser.id, "vidL2")
		await pool.query("INSERT INTO votes (lyrics_id, user_id, vote, is_self_vote) VALUES ($1,$2,1,0)", [
			l1,
			oldUser.id,
		])
		await pool.query("INSERT INTO votes (lyrics_id, user_id, vote, is_self_vote) VALUES ($1,$2,-1,0)", [
			l1,
			newUser.id,
		])
		await pool.query("INSERT INTO votes (lyrics_id, user_id, vote, is_self_vote) VALUES ($1,$2,1,1)", [
			l2,
			newUser.id,
		])
		await pool.query(
			"INSERT INTO discord_links (discord_id, key_id, discord_username) VALUES ('disc-1', $1, 'alice')",
			[OLD_KEY]
		)

		const before = {
			usersOld: await num("SELECT count(*)::int n FROM users WHERE key_id = $1", [OLD_KEY]),
			usersNew: await num("SELECT count(*)::int n FROM users WHERE key_id = $1", [NEW_KEY]),
			oldVotes: await num("SELECT count(*)::int n FROM votes WHERE user_id = $1", [oldUser.id]),
			newVotes: await num("SELECT count(*)::int n FROM votes WHERE user_id = $1", [newUser.id]),
			l2Submitter: (await one<{ submitter_id: number }>(
				"SELECT submitter_id FROM lyrics WHERE id = $1",
				[l2]
			)).submitter_id,
			newRep: (await one<{ reputation: number }>("SELECT reputation FROM users WHERE id = $1", [
				newUser.id,
			])).reputation,
		}

		const plan = await computeMigrationPlan(env, OLD_KEY, NEW_KEY)
		if ("error" in plan) throw new Error(plan.error)
		const auditId = await createPreviewAudit(env, {
			sessionId: "sess-2",
			discordId: "disc-1",
			oldKey: OLD_KEY,
			newKey: NEW_KEY,
			counts: plan.counts,
		})
		const result = await runMigration(env, { oldKey: OLD_KEY, newKey: NEW_KEY })
		if ("error" in result) throw new Error(result.error)
		await markAuditCommitted(env, auditId, result.moved, result.snapshot)

		const audit = await getAudit(env, auditId)
		expect(audit?.status).toBe("committed")

		const restore = await restoreFromSnapshot(env, auditId)
		expect(restore).toEqual({ restored: true })

		expect(await num("SELECT count(*)::int n FROM users WHERE key_id = $1", [OLD_KEY])).toBe(
			before.usersOld
		)
		expect(await num("SELECT count(*)::int n FROM users WHERE key_id = $1", [NEW_KEY])).toBe(
			before.usersNew
		)
		expect(await num("SELECT count(*)::int n FROM votes WHERE user_id = $1", [oldUser.id])).toBe(
			before.oldVotes
		)
		expect(await num("SELECT count(*)::int n FROM votes WHERE user_id = $1", [newUser.id])).toBe(
			before.newVotes
		)
		expect(
			(await one<{ submitter_id: number }>("SELECT submitter_id FROM lyrics WHERE id = $1", [l2]))
				.submitter_id
		).toBe(before.l2Submitter)
		expect(
			(await one<{ reputation: number }>("SELECT reputation FROM users WHERE id = $1", [newUser.id]))
				.reputation
		).toBe(before.newRep)
		expect(await num("SELECT count(*)::int n FROM discord_links WHERE key_id = $1", [OLD_KEY])).toBe(1)
		expect(await num("SELECT count(*)::int n FROM discord_links WHERE key_id = $1", [NEW_KEY])).toBe(0)
	})
})
