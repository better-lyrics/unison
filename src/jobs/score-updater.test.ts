import type { Env } from "@/types"
import { describe, expect, it, vi } from "vitest"
import { config } from "@/config"
import {
	calculateScore,
	recalculateScore,
	updateReputations,
	updateScores,
} from "@/jobs/score-updater"

vi.mock("@/db/lyrics", () => ({
	invalidateCache: vi.fn(() => Promise.resolve()),
}))

interface MockDBResult {
	db: Env["DB"]
	calls: { sql: string; params: unknown[] }[]
	transactionCount: number
}

function createMockDB(queue: unknown[]): MockDBResult {
	const calls: { sql: string; params: unknown[] }[] = []
	const state = { transactionCount: 0 }
	const db = {
		prepare(sql: string) {
			let params: unknown[] = []
			return {
				bind(...args: unknown[]) {
					params = args
					return this
				},
				async first<T>(): Promise<T | null> {
					calls.push({ sql, params })
					return (queue.shift() as T) ?? null
				},
				async all<T>(): Promise<{ results: T[] }> {
					calls.push({ sql, params })
					return { results: (queue.shift() as T[]) ?? [] }
				},
				async run(): Promise<void> {
					calls.push({ sql, params })
				},
			}
		},
		async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
			state.transactionCount++
			return fn(db)
		},
	}
	return {
		db: db as unknown as Env["DB"],
		calls,
		get transactionCount() {
			return state.transactionCount
		},
	}
}

describe("calculateScore", () => {
	it("returns correct weighted score for equal reputation votes", () => {
		const votes = [
			{ vote: 1, reputation: 1.0, avg_vote: 0.5, is_self_vote: 0 },
			{ vote: 1, reputation: 1.0, avg_vote: 0.3, is_self_vote: 0 },
			{ vote: -1, reputation: 1.0, avg_vote: -0.2, is_self_vote: 0 },
		]

		const result = calculateScore(1, votes)

		expect(result.effective_score).toBeCloseTo(0.333, 2)
		expect(result.vote_count).toBe(3)
	})

	it("weights votes by user reputation", () => {
		const votes = [
			{ vote: 1, reputation: 2.0, avg_vote: 0.5, is_self_vote: 0 },
			{ vote: -1, reputation: 0.5, avg_vote: 0.3, is_self_vote: 0 },
		]

		const result = calculateScore(1, votes)

		// (1 * 2.0 + -1 * 0.5) / (2.0 + 0.5) = 1.5 / 2.5 = 0.6
		expect(result.effective_score).toBeCloseTo(0.6, 2)
	})

	it("reduces self-vote weight by half", () => {
		const votes = [
			{ vote: 1, reputation: 1.0, avg_vote: 0.5, is_self_vote: 1 },
			{ vote: 1, reputation: 1.0, avg_vote: 0.3, is_self_vote: 0 },
		]

		const result = calculateScore(1, votes)

		// (1 * 0.5 + 1 * 1.0) / (0.5 + 1.0) = 1.5 / 1.5 = 1.0
		expect(result.effective_score).toBe(1)
	})

	it("detects diversity bonus when both harsh and generous raters upvote", () => {
		const votes = [
			{ vote: 1, reputation: 1.0, avg_vote: -0.5, is_self_vote: 0 },
			{ vote: 1, reputation: 1.0, avg_vote: 0.5, is_self_vote: 0 },
		]

		const result = calculateScore(1, votes)

		expect(result.diversity_bonus).toBe(1)
	})

	it("no diversity bonus when only one type of rater upvotes", () => {
		const votes = [
			{ vote: 1, reputation: 1.0, avg_vote: 0.5, is_self_vote: 0 },
			{ vote: 1, reputation: 1.0, avg_vote: 0.3, is_self_vote: 0 },
			{ vote: -1, reputation: 1.0, avg_vote: -0.2, is_self_vote: 0 },
		]

		const result = calculateScore(1, votes)

		expect(result.diversity_bonus).toBe(0)
	})

	it("returns low confidence for fewer than 3 votes", () => {
		const votes = [
			{ vote: 1, reputation: 1.0, avg_vote: 0.5, is_self_vote: 0 },
			{ vote: 1, reputation: 1.0, avg_vote: -0.5, is_self_vote: 0 },
		]

		const result = calculateScore(1, votes)

		expect(result.confidence).toBe("low")
	})

	it("returns medium confidence for 3+ votes without diversity", () => {
		const votes = Array.from({ length: 3 }, () => ({
			vote: 1,
			reputation: 1.0,
			avg_vote: 0.5,
			is_self_vote: 0,
		}))

		const result = calculateScore(1, votes)

		expect(result.confidence).toBe("medium")
	})

	it("returns high confidence for 3+ votes with diversity", () => {
		const votes = [
			{ vote: 1, reputation: 1.0, avg_vote: -0.5, is_self_vote: 0 },
			{ vote: 1, reputation: 1.0, avg_vote: 0.5, is_self_vote: 0 },
			{ vote: 1, reputation: 1.0, avg_vote: 0.3, is_self_vote: 0 },
		]

		const result = calculateScore(1, votes)

		expect(result.confidence).toBe("high")
	})

	it("handles empty votes array", () => {
		const result = calculateScore(1, [])

		expect(result.effective_score).toBe(0)
		expect(result.vote_count).toBe(0)
		expect(result.confidence).toBe("low")
	})

	it("handles all downvotes", () => {
		const votes = [
			{ vote: -1, reputation: 1.0, avg_vote: 0.5, is_self_vote: 0 },
			{ vote: -1, reputation: 1.0, avg_vote: -0.2, is_self_vote: 0 },
		]

		const result = calculateScore(1, votes)

		expect(result.effective_score).toBe(-1)
		expect(result.diversity_bonus).toBe(0)
	})

	it("handles mixed high and low reputation users", () => {
		const votes = [
			{ vote: 1, reputation: 2.0, avg_vote: 0.5, is_self_vote: 0 },
			{ vote: -1, reputation: 0.6, avg_vote: 0.3, is_self_vote: 0 },
		]

		const result = calculateScore(1, votes)

		// (1 * 2.0 + -1 * 0.6) / (2.0 + 0.6) = 1.4 / 2.6 = 0.5385
		expect(result.effective_score).toBeCloseTo(0.538, 2)
	})

	it("excludes votes below the weight floor from effective_score", () => {
		const votes = [
			{ vote: 1, reputation: 1.0, avg_vote: 0.5, is_self_vote: 0 },
			{ vote: -1, reputation: 0.4, avg_vote: -0.2, is_self_vote: 0 },
			{ vote: -1, reputation: 0.3, avg_vote: -0.1, is_self_vote: 0 },
		]

		const result = calculateScore(1, votes)

		expect(result.effective_score).toBeCloseTo(1.0, 2)
	})

	it("keeps vote_count honest when votes are below the weight floor", () => {
		const votes = [
			{ vote: 1, reputation: 1.0, avg_vote: 0.5, is_self_vote: 0 },
			{ vote: -1, reputation: 0.4, avg_vote: -0.2, is_self_vote: 0 },
		]

		const result = calculateScore(1, votes)

		expect(result.vote_count).toBe(2)
	})

	it("includes votes exactly at the weight floor", () => {
		const votes = [{ vote: 1, reputation: 0.5, avg_vote: 0.0, is_self_vote: 0 }]

		const result = calculateScore(1, votes)

		expect(result.effective_score).toBeCloseTo(1.0, 2)
	})

	it("filters sub-floor self-votes by raw reputation, not by post-discount weight", () => {
		const votes = [
			{ vote: 1, reputation: 1.0, avg_vote: 0.5, is_self_vote: 0 },
			{ vote: -1, reputation: 0.4, avg_vote: 0.0, is_self_vote: 1 },
		]

		const result = calculateScore(1, votes)

		expect(result.effective_score).toBeCloseTo(1.0, 2)
		expect(result.vote_count).toBe(2)
	})
})

describe("confidence score floor", () => {
	it("returns low confidence when score is below the floor despite enough votes", () => {
		const votes = [
			{ vote: 1, reputation: 1.0, avg_vote: 0.5, is_self_vote: 0 },
			{ vote: 1, reputation: 1.0, avg_vote: 0.3, is_self_vote: 0 },
			{ vote: -1, reputation: 1.0, avg_vote: -0.2, is_self_vote: 0 },
		]

		const result = calculateScore(1, votes)

		expect(result.effective_score).toBeCloseTo(0.333, 2)
		expect(result.effective_score).toBeLessThan(config.reputation.minScoreForConfidence)
		expect(result.confidence).toBe("low")
	})

	it("does not award high confidence when diverse raters agree but score is below the floor", () => {
		const votes = [
			{ vote: 1, reputation: 1.0, avg_vote: -0.5, is_self_vote: 0 },
			{ vote: 1, reputation: 1.0, avg_vote: 0.5, is_self_vote: 0 },
			{ vote: -1, reputation: 2.0, avg_vote: 0.0, is_self_vote: 0 },
		]

		const result = calculateScore(1, votes)

		expect(result.diversity_bonus).toBe(1)
		expect(result.effective_score).toBeLessThan(config.reputation.minScoreForConfidence)
		expect(result.confidence).toBe("low")
	})

	it("awards medium confidence at exactly the score floor", () => {
		const votes = [
			{ vote: 1, reputation: 2.0, avg_vote: 0.5, is_self_vote: 0 },
			{ vote: 1, reputation: 1.0, avg_vote: 0.3, is_self_vote: 0 },
			{ vote: -1, reputation: 1.0, avg_vote: -0.2, is_self_vote: 0 },
		]

		const result = calculateScore(1, votes)

		expect(result.effective_score).toBeCloseTo(config.reputation.minScoreForConfidence, 5)
		expect(result.confidence).toBe("medium")
	})

	it("still awards high confidence for a strong, diverse, well-voted row", () => {
		const votes = [
			{ vote: 1, reputation: 1.0, avg_vote: -0.5, is_self_vote: 0 },
			{ vote: 1, reputation: 1.0, avg_vote: 0.5, is_self_vote: 0 },
			{ vote: 1, reputation: 1.0, avg_vote: 0.3, is_self_vote: 0 },
		]

		const result = calculateScore(1, votes)

		expect(result.effective_score).toBeGreaterThanOrEqual(config.reputation.minScoreForConfidence)
		expect(result.confidence).toBe("high")
	})
})

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

	it("binds the configured threshold, delta, min, and max in order", async () => {
		const { env, calls } = createMockEnv()
		await updateReputations(env)
		expect(calls[0].params).toEqual([
			config.reputation.minVotesForConfidence,
			config.reputation.consensusDelta,
			-config.reputation.consensusDelta,
			config.reputation.min,
			config.reputation.max,
		])
	})

	it("does not apply unary minus to a bind placeholder", async () => {
		const { env, calls } = createMockEnv()
		await updateReputations(env)
		expect(calls[0].sql).not.toMatch(/-\s*\?/)
	})
})

describe("soft-delete handling", () => {
	it("recalculateScore early-returns when the row is deleted (no UPDATE)", async () => {
		const { db, calls } = createMockDB([{ video_id: "v1", deleted_at: 1700000000 }])
		const env = { DB: db } as unknown as Env

		await recalculateScore(env, 1)

		expect(calls).toHaveLength(1)
		expect(calls[0].sql).toMatch(/SELECT\s+video_id,\s+deleted_at/i)
	})

	it("recalculateScore early-returns when the row does not exist", async () => {
		const { db, calls } = createMockDB([null])
		const env = { DB: db } as unknown as Env

		await recalculateScore(env, 999)

		expect(calls).toHaveLength(1)
	})

	it("staleLyrics query filters deleted rows in both UNION branches", async () => {
		const { db, calls } = createMockDB([null, null, []])
		const env = { DB: db } as unknown as Env

		await updateScores(env)

		const staleSql = calls.find(
			(c) => c.sql.includes("staleLyrics") || c.sql.includes("score_updated_at IS NULL")
		)
		expect(staleSql).toBeDefined()
		const occurrences = (staleSql?.sql.match(/deleted_at\s+IS\s+NULL/gi) ?? []).length
		expect(occurrences).toBeGreaterThanOrEqual(2)
	})

	it("updateReputations query does NOT filter deleted rows (load-bearing)", async () => {
		const { db, calls } = createMockDB([null])
		const env = { DB: db } as unknown as Env

		await updateReputations(env)

		expect(calls[0].sql).not.toMatch(/deleted_at/i)
	})
})

describe("auto-hide reputation penalty", () => {
	it("applies penalty to submitters of newly auto-hidden rows", async () => {
		const { db, calls } = createMockDB([[], [{ id: 10, submitter_id: 42 }]])
		const env = { DB: db } as unknown as Env

		await updateScores(env)

		const userUpdate = calls.find(
			(c) =>
				c.sql.includes("UPDATE users") &&
				c.sql.includes("reputation - ?") &&
				c.sql.includes("WHERE id = ?")
		)
		expect(userUpdate).toBeDefined()
		expect(userUpdate?.params).toEqual([
			config.reputation.min,
			config.moderation.autoHide.reputationPenalty,
			42,
		])

		const markUpdate = calls.find(
			(c) => c.sql.includes("UPDATE lyrics") && c.sql.includes("reputation_penalized = TRUE")
		)
		expect(markUpdate).toBeDefined()
		expect(markUpdate?.sql).toMatch(/AND\s+reputation_penalized\s*=\s*FALSE/i)
		expect(markUpdate?.sql).toMatch(/RETURNING\s+id,\s*submitter_id/i)
	})

	it("guards the in-transaction mark UPDATE with reputation_penalized = FALSE", async () => {
		const { db, calls } = createMockDB([[], []])
		const env = { DB: db } as unknown as Env

		await updateScores(env)

		const markUpdate = calls.find(
			(c) => c.sql.includes("UPDATE lyrics") && c.sql.includes("reputation_penalized = TRUE")
		)
		expect(markUpdate).toBeDefined()
		expect(markUpdate?.sql).toMatch(/AND\s+reputation_penalized\s*=\s*FALSE/i)
		expect(markUpdate?.sql).toMatch(/AND\s+deleted_at\s+IS\s+NULL/i)
		expect(markUpdate?.sql).toMatch(/AND\s+submitter_id\s+IS\s+NOT\s+NULL/i)
	})

	it("sums penalty when a submitter has multiple newly-hidden rows", async () => {
		const { db, calls } = createMockDB([
			[],
			[
				{ id: 10, submitter_id: 42 },
				{ id: 11, submitter_id: 42 },
			],
		])
		const env = { DB: db } as unknown as Env

		await updateScores(env)

		const userUpdates = calls.filter(
			(c) =>
				c.sql.includes("UPDATE users") &&
				c.sql.includes("reputation - ?") &&
				c.sql.includes("WHERE id = ?")
		)
		expect(userUpdates).toHaveLength(1)
		const totalPenalty = config.moderation.autoHide.reputationPenalty * 2
		expect(userUpdates[0].params).toEqual([config.reputation.min, totalPenalty, 42])
	})

	it("wraps the mark UPDATE and user-penalty updates in a single transaction", async () => {
		const result = createMockDB([[], [{ id: 10, submitter_id: 42 }]])
		const env = { DB: result.db } as unknown as Env

		await updateScores(env)

		expect(result.transactionCount).toBe(1)
	})

	it("does not fire UPDATE users when nothing was flipped", async () => {
		const { db, calls } = createMockDB([[], []])
		const env = { DB: db } as unknown as Env

		await updateScores(env)

		const userPenalty = calls.find(
			(c) =>
				c.sql.includes("UPDATE users") &&
				c.sql.includes("reputation - ?") &&
				c.sql.includes("WHERE id = ?")
		)
		expect(userPenalty).toBeUndefined()
	})

	it("rolls back the mark UPDATE when the user-penalty update throws", async () => {
		const calls: { sql: string; params: unknown[] }[] = []
		const state = { transactionCount: 0, committed: true }
		const queue: unknown[] = [[], [{ id: 10, submitter_id: 42 }]]
		const db = {
			prepare(sql: string) {
				let params: unknown[] = []
				return {
					bind(...args: unknown[]) {
						params = args
						return this
					},
					async first<T>(): Promise<T | null> {
						calls.push({ sql, params })
						return (queue.shift() as T) ?? null
					},
					async all<T>(): Promise<{ results: T[] }> {
						calls.push({ sql, params })
						return { results: (queue.shift() as T[]) ?? [] }
					},
					async run(): Promise<void> {
						calls.push({ sql, params })
						if (sql.includes("UPDATE users") && sql.includes("reputation - ?")) {
							throw new Error("simulated failure")
						}
					},
				}
			},
			async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
				state.transactionCount++
				try {
					return await fn(db)
				} catch (err) {
					state.committed = false
					throw err
				}
			},
		}
		const env = { DB: db } as unknown as Env

		await expect(updateScores(env)).rejects.toThrow("simulated failure")
		expect(state.transactionCount).toBe(1)
		expect(state.committed).toBe(false)
	})
})

describe("updateScores pipeline order", () => {
	it("runs avg_vote, then updateReputations, then safety-net, then applyAutoHidePenalty", async () => {
		const { db, calls } = createMockDB([[], []])
		const env = { DB: db } as unknown as Env

		await updateScores(env)

		const avgVoteIdx = calls.findIndex(
			(c) => c.sql.includes("UPDATE users") && c.sql.includes("avg_vote =")
		)
		const reputationIdx = calls.findIndex(
			(c) => c.sql.includes("consensus_lyrics") || c.sql.includes("WITH consensus_lyrics")
		)
		const safetyNetIdx = calls.findIndex(
			(c) => c.sql.includes("SELECT") && c.sql.includes("id AS lyrics_id")
		)
		const penaltyIdx = calls.findIndex(
			(c) => c.sql.includes("UPDATE lyrics") && c.sql.includes("reputation_penalized = TRUE")
		)

		expect(avgVoteIdx).toBeGreaterThanOrEqual(0)
		expect(reputationIdx).toBeGreaterThan(avgVoteIdx)
		expect(safetyNetIdx).toBeGreaterThan(reputationIdx)
		expect(penaltyIdx).toBeGreaterThan(safetyNetIdx)
	})
})

describe("reputation bounds", () => {
	it("config has correct reputation bounds", () => {
		expect(config.reputation.min).toBe(0.0)
		expect(config.reputation.max).toBe(2.0)
		expect(config.reputation.default).toBe(1.0)
	})

	it("config has correct self-vote weight", () => {
		expect(config.reputation.selfVoteWeight).toBe(0.5)
	})

	it("config has correct minimum votes for confidence", () => {
		expect(config.reputation.minVotesForConfidence).toBe(3)
	})

	it("config has correct consensus delta", () => {
		expect(config.reputation.consensusDelta).toBe(0.1)
	})
})

describe("recalculateScore vote-count resync", () => {
	it("recomputes upvotes and downvotes from the votes rows so they cannot drift", async () => {
		const votes = [
			{ vote: 1, reputation: 1.0, avg_vote: 0.2, is_self_vote: 0 },
			{ vote: 1, reputation: 1.0, avg_vote: 0.3, is_self_vote: 0 },
			{ vote: -1, reputation: 1.0, avg_vote: -0.1, is_self_vote: 0 },
		]
		const { db, calls } = createMockDB([{ video_id: "v1", deleted_at: null }, votes])
		const env = { DB: db } as unknown as Env

		await recalculateScore(env, 1)

		const update = calls.find(
			(c) => c.sql.includes("UPDATE lyrics") && /upvotes\s*=\s*\?/.test(c.sql)
		)
		expect(update).toBeDefined()
		expect(update?.sql).toMatch(/downvotes\s*=\s*\?/)
		// bind order: effective_score, vote_count, upvotes, downvotes, ...
		expect(update?.params[2]).toBe(2)
		expect(update?.params[3]).toBe(1)
	})

	it("zeroes upvotes and downvotes when a row has no votes", async () => {
		const { db, calls } = createMockDB([{ video_id: "v1", deleted_at: null }, []])
		const env = { DB: db } as unknown as Env

		await recalculateScore(env, 1)

		const update = calls.find(
			(c) => c.sql.includes("UPDATE lyrics") && /upvotes\s*=\s*\?/.test(c.sql)
		)
		expect(update?.params[2]).toBe(0)
		expect(update?.params[3]).toBe(0)
	})
})
