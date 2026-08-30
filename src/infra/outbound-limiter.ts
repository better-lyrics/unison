import { Logger } from "@/infra/logger"

const log = new Logger("outbound-limiter")

const RATE_PER_SEC = Number.parseFloat(process.env.GOOGLE_RATE_PER_SEC || "2")
const BURST = Number.parseInt(process.env.GOOGLE_BURST || "10", 10)
const RETRY_ATTEMPTS = Number.parseInt(process.env.GOOGLE_RETRY_ATTEMPTS || "3", 10)
const RETRY_BASE_MS = Number.parseInt(process.env.GOOGLE_RETRY_BASE_MS || "500", 10)
const MAX_QUEUE_WAIT_MS = Number.parseInt(process.env.GOOGLE_MAX_QUEUE_WAIT_MS || "8000", 10)
const CIRCUIT_THRESHOLD = Number.parseInt(process.env.GOOGLE_CIRCUIT_THRESHOLD || "5", 10)
const CIRCUIT_BASE_OPEN_MS = Number.parseInt(
	process.env.GOOGLE_CIRCUIT_BASE_OPEN_MS || "300000",
	10
)
const CIRCUIT_MAX_OPEN_MS = Number.parseInt(
	process.env.GOOGLE_CIRCUIT_MAX_OPEN_MS || "14400000",
	10
)
const CIRCUIT_MULTIPLIER = Number.parseFloat(process.env.GOOGLE_CIRCUIT_MULTIPLIER || "4")

export class UpstreamRateLimitedError extends Error {
	constructor() {
		super("upstream rate limited")
		this.name = "UpstreamRateLimitedError"
	}
}

export class QueueTimeoutError extends Error {
	constructor(public readonly waitedMs: number) {
		super(`outbound throttle queue wait exceeded ${waitedMs}ms`)
		this.name = "QueueTimeoutError"
	}
}

export class TokenBucket {
	tokens: number
	lastRefill: number

	constructor(
		public readonly capacity: number,
		public readonly refillPerSecond: number,
		now = Date.now()
	) {
		this.tokens = capacity
		this.lastRefill = now
	}

	refill(now = Date.now()): void {
		const elapsed = (now - this.lastRefill) / 1000
		if (elapsed <= 0) return
		this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond)
		this.lastRefill = now
	}

	tryConsume(now = Date.now()): boolean {
		this.refill(now)
		if (this.tokens >= 1) {
			this.tokens -= 1
			return true
		}
		return false
	}

	msUntilNextToken(now = Date.now()): number {
		this.refill(now)
		if (this.tokens >= 1) return 0
		return Math.ceil(((1 - this.tokens) * 1000) / this.refillPerSecond)
	}
}

interface CircuitState {
	consecutiveFailures: number
	trips: number
	openUntil: number
}

export interface CircuitBreaker {
	check(): void
	recordSuccess(): void
	recordFailure(): void
	stateOf(): CircuitState
}

export function createCircuitBreaker(opts: {
	threshold: number
	baseOpenMs: number
	maxOpenMs: number
	multiplier: number
	now?: () => number
}): CircuitBreaker {
	const now = opts.now ?? Date.now
	const state: CircuitState = { consecutiveFailures: 0, trips: 0, openUntil: 0 }

	function cooldownMsForTrips(trips: number): number {
		const ms = opts.baseOpenMs * opts.multiplier ** Math.max(0, trips - 1)
		return Math.min(ms, opts.maxOpenMs)
	}

	return {
		check() {
			if (state.openUntil === 0) return
			if (now() < state.openUntil) {
				throw new UpstreamRateLimitedError()
			}
			log.info("circuit closed after cooldown", { trips: state.trips })
			state.openUntil = 0
			state.consecutiveFailures = 0
		},
		recordSuccess() {
			if (state.consecutiveFailures > 0 || state.trips > 0 || state.openUntil > 0) {
				log.info("circuit reset on success")
			}
			state.consecutiveFailures = 0
			state.trips = 0
			state.openUntil = 0
		},
		recordFailure() {
			state.consecutiveFailures += 1
			if (state.consecutiveFailures >= opts.threshold) {
				state.trips += 1
				const cooldown = cooldownMsForTrips(state.trips)
				state.openUntil = now() + cooldown
				log.error("circuit OPEN", {
					trips: state.trips,
					cooldownMs: cooldown,
					cooldownMin: Math.round(cooldown / 60000),
				})
				state.consecutiveFailures = 0
			} else {
				log.warn("upstream failure recorded", {
					consecutiveFailures: state.consecutiveFailures,
					threshold: opts.threshold,
				})
			}
		},
		stateOf() {
			return { ...state }
		},
	}
}

const bucket = new TokenBucket(BURST, RATE_PER_SEC)

const circuitBreaker = createCircuitBreaker({
	threshold: CIRCUIT_THRESHOLD,
	baseOpenMs: CIRCUIT_BASE_OPEN_MS,
	maxOpenMs: CIRCUIT_MAX_OPEN_MS,
	multiplier: CIRCUIT_MULTIPLIER,
})

export async function acquireSlot(maxWaitMs = MAX_QUEUE_WAIT_MS): Promise<number> {
	const start = Date.now()
	while (true) {
		if (bucket.tryConsume()) {
			return Date.now() - start
		}
		const waited = Date.now() - start
		if (waited >= maxWaitMs) {
			throw new QueueTimeoutError(waited)
		}
		const tokenWaitMs = bucket.msUntilNextToken()
		const sleepMs = Math.min(tokenWaitMs, maxWaitMs - waited)
		await new Promise<void>((r) => setTimeout(r, sleepMs))
	}
}

export async function fetchLyricsTranslateWithRetry(
	url: string,
	init: RequestInit
): Promise<Response> {
	circuitBreaker.check()

	for (let attempt = 0; ; attempt++) {
		let waited: number
		try {
			waited = await acquireSlot()
		} catch (err) {
			if (err instanceof QueueTimeoutError) {
				log.warn("queue timeout, failing fast", {
					waitedMs: err.waitedMs,
					maxWaitMs: MAX_QUEUE_WAIT_MS,
				})
				throw new UpstreamRateLimitedError()
			}
			throw err
		}
		if (waited > 2000) {
			log.warn("throttle wait", { waitedMs: waited })
		}

		const res = await fetch(url, init)

		if (res.status === 429) {
			if (attempt < RETRY_ATTEMPTS - 1) {
				const backoffMs = RETRY_BASE_MS * 2 ** attempt
				log.warn("429 from upstream, backing off", {
					attempt: attempt + 1,
					of: RETRY_ATTEMPTS,
					backoffMs,
				})
				await new Promise<void>((r) => setTimeout(r, backoffMs))
				continue
			}
			circuitBreaker.recordFailure()
			return res
		}

		circuitBreaker.recordSuccess()
		return res
	}
}

export function getLimiterStats() {
	bucket.refill()
	return {
		tokens: Math.floor(bucket.tokens),
		capacity: bucket.capacity,
		refillPerSecond: bucket.refillPerSecond,
		circuit: circuitBreaker.stateOf(),
	}
}
