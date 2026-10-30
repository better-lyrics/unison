import { config } from "@/config"
import { COUNTED_VOTER_PREDICATE } from "@/db/predicates"
import { updateReputations } from "@/db/reputation"
import { isReputationRefresh, refreshParams } from "@/test/reputation-refresh"
import type { Env } from "@/types"
import { describe, expect, it } from "vitest"

interface DBCall {
	sql: string
	params: unknown[]
}

function createMockEnv(): { env: Env; calls: DBCall[] } {
	const calls: DBCall[] = []
	const db = {
		prepare(sql: string) {
			let params: unknown[] = []
			return {
				bind(...args: unknown[]) {
					params = args
					return this
				},
				async run() {
					calls.push({ sql, params })
				},
			}
		},
	}
	const env = { DB: db } as unknown as Env
	return { env, calls }
}

describe("updateReputations", () => {
	it("updates users from consensus agreement in one CTE statement", async () => {
		const { env, calls } = createMockEnv()
		await updateReputations(env)
		const sql = calls[0].sql
		expect(sql).toMatch(/WITH\s+consensus_lyrics\s+AS/i)
		expect(sql).toMatch(/JOIN\s+consensus_lyrics/i)
		expect(sql).toMatch(/UPDATE\s+users/i)
		expect(sql).toMatch(/GREATEST\(.+LEAST\(/i)
	})

	it("binds threshold, clamp bounds, default, delta and the negative penalties in order", async () => {
		const { env, calls } = createMockEnv()
		await updateReputations(env)
		expect(calls[0].params).toEqual([
			config.reputation.minVotesForConfidence,
			config.reputation.min,
			config.reputation.max,
			config.reputation.default,
			config.reputation.consensusDelta,
			-config.moderation.autoHide.reputationPenalty,
			-config.voteIntegrity.repeatPenalty.reputation,
		])
	})

	it("counts penalised lyrics, live repeat strikes and only counted voters", async () => {
		const { env, calls } = createMockEnv()
		await updateReputations(env)
		expect(calls[0].sql).toMatch(/WHERE reputation_penalized AND submitter_id IS NOT NULL/)
		expect(calls[0].sql).toMatch(/WHERE repeat AND undone_at IS NULL/)
		expect(calls[0].sql).toContain(COUNTED_VOTER_PREDICATE)
	})

	describe("edge cases", () => {
		it("an empty scope issues no statement", async () => {
			const { env, calls } = createMockEnv()
			await updateReputations(env, [])
			expect(calls).toHaveLength(0)
		})

		it("a scoped run filters every aggregate by the given ids", async () => {
			const { env, calls } = createMockEnv()
			await updateReputations(env, [7, 9])
			expect(isReputationRefresh(calls[0].sql)).toBe(true)
			expect(calls[0].sql.match(/= ANY\(\?::int\[\]\)/g)).toHaveLength(4)
			expect(calls[0].params).toEqual(refreshParams([7, 9]))
		})
	})

	describe("regressions", () => {
		it("regression: does not apply unary minus to a bind placeholder", async () => {
			const { env, calls } = createMockEnv()
			await updateReputations(env, [1])
			expect(calls[0].sql).not.toMatch(/-\s*\?/)
		})

		it("regression: does not count penalties from the XP ledger, which misses older ones", async () => {
			const { env, calls } = createMockEnv()
			await updateReputations(env)
			expect(calls[0].sql).not.toMatch(/kind = 'penalized'/)
		})

		it("regression: does not filter deleted lyrics", async () => {
			const { env, calls } = createMockEnv()
			await updateReputations(env)
			expect(calls[0].sql).not.toMatch(/deleted_at/i)
		})
	})

	describe("invariants", () => {
		it("excludes self votes", async () => {
			const { env, calls } = createMockEnv()
			await updateReputations(env)
			expect(calls[0].sql).toMatch(/is_self_vote\s*=\s*0/i)
		})

		it("a full run never filters by id", async () => {
			const { env, calls } = createMockEnv()
			await updateReputations(env)
			expect(calls).toHaveLength(1)
			expect(isReputationRefresh(calls[0].sql)).toBe(false)
		})
	})
})
