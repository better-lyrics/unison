import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TokenBucket, createCircuitBreaker } from "./outbound-limiter"

describe("TokenBucket", () => {
	it("refills proportionally to elapsed time", () => {
		const b = new TokenBucket(10, 2, 0)
		b.tokens = 0
		b.refill(1000)
		expect(b.tokens).toBe(2)
	})

	it("never refills beyond capacity", () => {
		const b = new TokenBucket(10, 2, 0)
		b.tokens = 9
		b.refill(10_000)
		expect(b.tokens).toBe(10)
	})

	it("tryConsume succeeds and decrements when a full token is available", () => {
		const b = new TokenBucket(10, 2, 0)
		b.tokens = 1
		expect(b.tryConsume(0)).toBe(true)
		expect(b.tokens).toBe(0)
	})

	it("tryConsume fails when fewer than one token is available", () => {
		const b = new TokenBucket(10, 2, 0)
		b.tokens = 0.9999
		expect(b.tryConsume(0)).toBe(false)
		expect(b.tokens).toBe(0.9999)
	})

	it("msUntilNextToken is zero when a token is available", () => {
		const b = new TokenBucket(10, 2, 0)
		expect(b.msUntilNextToken(0)).toBe(0)
	})

	it("msUntilNextToken reflects the refill rate when empty", () => {
		const b = new TokenBucket(10, 2, 0)
		b.tokens = 0
		expect(b.msUntilNextToken(0)).toBe(500)
		b.tokens = 0.5
		expect(b.msUntilNextToken(0)).toBe(250)
	})

	describe("edge cases", () => {
		it("accumulates fractional tokens across successive refills", () => {
			const b = new TokenBucket(10, 2, 0)
			b.tokens = 0
			b.refill(250)
			expect(b.tokens).toBeCloseTo(0.5, 10)
			b.refill(500)
			expect(b.tokens).toBeCloseTo(1, 10)
			expect(b.tryConsume(500)).toBe(true)
		})

		it("treats a non-positive elapsed interval as a no-op", () => {
			const b = new TokenBucket(10, 2, 1000)
			b.tokens = 5
			b.refill(1000)
			expect(b.tokens).toBe(5)
			expect(b.lastRefill).toBe(1000)
			b.refill(500)
			expect(b.tokens).toBe(5)
			expect(b.lastRefill).toBe(1000)
		})
	})

	describe("invariants", () => {
		it("tryConsume removes exactly one token", () => {
			const b = new TokenBucket(10, 2, 0)
			b.tokens = 7
			b.tryConsume(0)
			expect(b.tokens).toBe(6)
		})

		it("a second refill at the same instant does not change tokens", () => {
			const b = new TokenBucket(10, 2, 0)
			b.tokens = 3
			b.refill(1000)
			const after = b.tokens
			b.refill(1000)
			expect(b.tokens).toBe(after)
		})
	})
})

describe("circuitBreaker", () => {
	it("stays closed while failures remain under the threshold", () => {
		const clock = 0
		const cb = createCircuitBreaker({
			threshold: 3,
			baseOpenMs: 1000,
			maxOpenMs: 10_000,
			multiplier: 2,
			now: () => clock,
		})
		cb.recordFailure()
		cb.recordFailure()
		expect(cb.stateOf().consecutiveFailures).toBe(2)
		expect(cb.stateOf().openUntil).toBe(0)
		expect(() => cb.check()).not.toThrow()
	})

	it("opens on the Nth consecutive failure", () => {
		const clock = 0
		const cb = createCircuitBreaker({
			threshold: 3,
			baseOpenMs: 1000,
			maxOpenMs: 10_000,
			multiplier: 2,
			now: () => clock,
		})
		cb.recordFailure()
		cb.recordFailure()
		cb.recordFailure()
		const s = cb.stateOf()
		expect(s.trips).toBe(1)
		expect(s.openUntil).toBe(1000)
		expect(s.consecutiveFailures).toBe(0)
	})

	it("check throws while the circuit is open", () => {
		let clock = 0
		const cb = createCircuitBreaker({
			threshold: 1,
			baseOpenMs: 1000,
			maxOpenMs: 10_000,
			multiplier: 2,
			now: () => clock,
		})
		cb.recordFailure()
		clock = 500
		expect(() => cb.check()).toThrow(/rate limited/i)
	})

	it("auto-closes once the cooldown has elapsed", () => {
		let clock = 0
		const cb = createCircuitBreaker({
			threshold: 1,
			baseOpenMs: 1000,
			maxOpenMs: 10_000,
			multiplier: 2,
			now: () => clock,
		})
		cb.recordFailure()
		clock = 1000
		expect(() => cb.check()).not.toThrow()
		expect(cb.stateOf().openUntil).toBe(0)
		expect(cb.stateOf().consecutiveFailures).toBe(0)
	})

	it("recordSuccess resets failures, trips, and openUntil", () => {
		let clock = 0
		const cb = createCircuitBreaker({
			threshold: 1,
			baseOpenMs: 1000,
			maxOpenMs: 10_000,
			multiplier: 2,
			now: () => clock,
		})
		cb.recordFailure()
		clock = 10
		cb.recordSuccess()
		expect(cb.stateOf()).toEqual({ consecutiveFailures: 0, trips: 0, openUntil: 0 })
	})

	describe("edge cases", () => {
		it("grows the cooldown exponentially per trip and caps at maxOpenMs", () => {
			let clock = 0
			const cb = createCircuitBreaker({
				threshold: 1,
				baseOpenMs: 1000,
				maxOpenMs: 5000,
				multiplier: 2,
				now: () => clock,
			})
			cb.recordFailure()
			expect(cb.stateOf().openUntil - clock).toBe(1000)
			clock = cb.stateOf().openUntil
			cb.check()
			cb.recordFailure()
			expect(cb.stateOf().openUntil - clock).toBe(2000)
			clock = cb.stateOf().openUntil
			cb.check()
			cb.recordFailure()
			expect(cb.stateOf().openUntil - clock).toBe(4000)
			clock = cb.stateOf().openUntil
			cb.check()
			cb.recordFailure()
			expect(cb.stateOf().openUntil - clock).toBe(5000)
		})
	})

	describe("invariants", () => {
		it("stateOf returns a snapshot that cannot mutate internal state", () => {
			const cb = createCircuitBreaker({
				threshold: 3,
				baseOpenMs: 1000,
				maxOpenMs: 10_000,
				multiplier: 2,
			})
			const snap = cb.stateOf()
			snap.trips = 999
			snap.consecutiveFailures = 999
			expect(cb.stateOf().trips).toBe(0)
			expect(cb.stateOf().consecutiveFailures).toBe(0)
		})
	})
})

describe("acquireSlot", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})
	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
		vi.unstubAllEnvs()
		vi.resetModules()
	})

	async function loadFresh(env: Record<string, string> = {}) {
		vi.resetModules()
		for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
		return import("./outbound-limiter")
	}

	it("returns immediately when a token is available", async () => {
		const { acquireSlot } = await loadFresh()
		await expect(acquireSlot()).resolves.toBe(0)
	})

	it("throws QueueTimeoutError once the wait budget is exhausted", async () => {
		const { acquireSlot, QueueTimeoutError } = await loadFresh({
			GOOGLE_RATE_PER_SEC: "0",
			GOOGLE_BURST: "0",
			GOOGLE_MAX_QUEUE_WAIT_MS: "100",
		})
		const p = acquireSlot()
		p.catch(() => {})
		await vi.advanceTimersByTimeAsync(100)
		await expect(p).rejects.toBeInstanceOf(QueueTimeoutError)
	})

	it("serializes concurrent callers so one token is never double-consumed", async () => {
		const { acquireSlot } = await loadFresh({ GOOGLE_BURST: "1", GOOGLE_RATE_PER_SEC: "1" })
		const a = acquireSlot()
		const b = acquireSlot()
		await expect(a).resolves.toBe(0)
		await vi.advanceTimersByTimeAsync(1000)
		expect(await b).toBeGreaterThanOrEqual(1000)
	})
})

describe("fetchLyricsTranslateWithRetry", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})
	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
		vi.unstubAllEnvs()
		vi.resetModules()
	})

	async function loadFresh(env: Record<string, string> = {}) {
		vi.resetModules()
		for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
		return import("./outbound-limiter")
	}

	it("returns a 200 immediately and records success", async () => {
		const { fetchLyricsTranslateWithRetry, getLimiterStats } = await loadFresh()
		const fetchSpy = vi.fn(async () => new Response("ok", { status: 200 }))
		vi.stubGlobal("fetch", fetchSpy)

		const res = await fetchLyricsTranslateWithRetry("https://example.test", {})
		expect(res.status).toBe(200)
		expect(fetchSpy).toHaveBeenCalledTimes(1)
		const { circuit } = getLimiterStats()
		expect(circuit.consecutiveFailures).toBe(0)
		expect(circuit.trips).toBe(0)
	})

	it("retries a 429 with exponential backoff then returns it and records a failure", async () => {
		const { fetchLyricsTranslateWithRetry, getLimiterStats } = await loadFresh()
		const callTimes: number[] = []
		const fetchSpy = vi.fn(async () => {
			callTimes.push(Date.now())
			return new Response(null, { status: 429 })
		})
		vi.stubGlobal("fetch", fetchSpy)

		const p = fetchLyricsTranslateWithRetry("https://example.test", {})
		await vi.advanceTimersByTimeAsync(5000)
		const res = await p

		expect(res.status).toBe(429)
		expect(fetchSpy).toHaveBeenCalledTimes(3)
		expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(500)
		expect(callTimes[2] - callTimes[1]).toBeGreaterThanOrEqual(1000)
		expect(getLimiterStats().circuit.consecutiveFailures).toBe(1)
	})

	it("opens the circuit after enough failures so the next call fails fast", async () => {
		const { fetchLyricsTranslateWithRetry, getLimiterStats, UpstreamRateLimitedError } =
			await loadFresh({
				GOOGLE_CIRCUIT_THRESHOLD: "1",
				GOOGLE_RETRY_ATTEMPTS: "1",
			})
		const fetchSpy = vi.fn(async () => new Response(null, { status: 429 }))
		vi.stubGlobal("fetch", fetchSpy)

		const first = await fetchLyricsTranslateWithRetry("https://example.test", {})
		expect(first.status).toBe(429)
		expect(getLimiterStats().circuit.openUntil).toBeGreaterThan(0)

		await expect(fetchLyricsTranslateWithRetry("https://example.test", {})).rejects.toBeInstanceOf(
			UpstreamRateLimitedError
		)
		expect(fetchSpy).toHaveBeenCalledTimes(1)
	})

	it("records a failure on a 5xx response", async () => {
		const { fetchLyricsTranslateWithRetry, getLimiterStats } = await loadFresh()
		const fetchSpy = vi.fn(async () => new Response("boom", { status: 500 }))
		vi.stubGlobal("fetch", fetchSpy)

		const res = await fetchLyricsTranslateWithRetry("https://example.test", {})
		expect(res.status).toBe(500)
		expect(getLimiterStats().circuit.consecutiveFailures).toBe(1)
	})

	it("does not reset an accrued failure when a later response is a non-server 4xx", async () => {
		const { fetchLyricsTranslateWithRetry, getLimiterStats } = await loadFresh()
		const statuses = [500, 403]
		const fetchSpy = vi.fn(async () => new Response(null, { status: statuses.shift() ?? 200 }))
		vi.stubGlobal("fetch", fetchSpy)

		await fetchLyricsTranslateWithRetry("https://example.test", {})
		await fetchLyricsTranslateWithRetry("https://example.test", {})
		expect(getLimiterStats().circuit.consecutiveFailures).toBe(1)
	})

	describe("edge cases", () => {
		it("maps a queue timeout to UpstreamRateLimitedError", async () => {
			const { fetchLyricsTranslateWithRetry, UpstreamRateLimitedError } = await loadFresh({
				GOOGLE_RATE_PER_SEC: "0",
				GOOGLE_BURST: "0",
				GOOGLE_MAX_QUEUE_WAIT_MS: "100",
			})
			const fetchSpy = vi.fn(async () => new Response("ok", { status: 200 }))
			vi.stubGlobal("fetch", fetchSpy)

			const p = fetchLyricsTranslateWithRetry("https://example.test", {})
			p.catch(() => {})
			await vi.advanceTimersByTimeAsync(100)
			await expect(p).rejects.toBeInstanceOf(UpstreamRateLimitedError)
			expect(fetchSpy).not.toHaveBeenCalled()
		})
	})

	describe("invariants", () => {
		it("getLimiterStats reflects capacity and refill configuration", async () => {
			const { getLimiterStats } = await loadFresh({
				GOOGLE_BURST: "7",
				GOOGLE_RATE_PER_SEC: "3",
			})
			const stats = getLimiterStats()
			expect(stats.capacity).toBe(7)
			expect(stats.refillPerSecond).toBe(3)
			expect(stats.tokens).toBeLessThanOrEqual(stats.capacity)
		})
	})
})
