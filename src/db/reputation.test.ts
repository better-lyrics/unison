import { config } from "@/config"
import { COUNTED_VOTER_PREDICATE } from "@/db/predicates"
import { updateReputations } from "@/db/reputation"
import type { Env } from "@/types"
import { describe, expect, it } from "vitest"

describe("updateReputations", () => {
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

	it("issues a single SQL statement (no N+1)", async () => {
		const { env, calls } = createMockEnv()
		await updateReputations(env)
		expect(calls).toHaveLength(1)
	})

	it("uses a CTE-based UPDATE that joins votes to consensus_lyrics", async () => {
		const { env, calls } = createMockEnv()
		await updateReputations(env)
		const sql = calls[0].sql
		expect(sql).toMatch(/WITH\s+consensus_lyrics\s+AS/i)
		expect(sql).toMatch(/JOIN\s+consensus_lyrics/i)
		expect(sql).toMatch(/UPDATE\s+users/i)
		expect(sql).toMatch(/GREATEST\(.+LEAST\(/i)
	})

	it("excludes self-votes from reputation deltas", async () => {
		const { env, calls } = createMockEnv()
		await updateReputations(env)
		expect(calls[0].sql).toMatch(/is_self_vote\s*=\s*0/i)
	})

	// Reputation is derived from history now (no per-run delta), so the binds name the formula terms.
	it("binds threshold, clamp bounds, default, delta and the negative penalty in order", async () => {
		const { env, calls } = createMockEnv()
		await updateReputations(env)
		expect(calls[0].params).toEqual([
			config.reputation.minVotesForConfidence,
			config.reputation.min,
			config.reputation.max,
			config.reputation.default,
			config.reputation.consensusDelta,
			-config.moderation.autoHide.reputationPenalty,
		])
	})

	it("counts penalized events and only counted voters", async () => {
		const { env, calls } = createMockEnv()
		await updateReputations(env)
		expect(calls[0].sql).toMatch(/kind = 'penalized'/)
		expect(calls[0].sql).toContain(COUNTED_VOTER_PREDICATE)
	})

	it("does not apply unary minus to a bind placeholder", async () => {
		const { env, calls } = createMockEnv()
		await updateReputations(env)
		expect(calls[0].sql).not.toMatch(/-\s*\?/)
	})
})
