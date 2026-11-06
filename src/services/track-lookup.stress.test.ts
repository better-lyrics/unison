import { config } from "@/config"
import { makeMemoryCache } from "@/test/integration-harness"
import type { Env } from "@/types"
import type { ProviderId } from "@/utils/provider-id"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type Lookup = typeof import("@/services/track-lookup")
type Upstream = (body: ProviderId[], signal: AbortSignal) => Promise<Response>

const { timeoutMs, pauseSec, maxPauseSec, pendingRetryAfterSec } = config.binilink
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

let lookup: Lookup

beforeEach(async () => {
	vi.stubEnv("LOG_LEVEL", "error")
	vi.resetModules()
	lookup = await import("@/services/track-lookup")
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.unstubAllEnvs()
	vi.useRealTimers()
})

function memoryEnv() {
	const cache = makeMemoryCache()
	return { cache, env: { CACHE: cache as unknown as Env["CACHE"] } as Env }
}

function spotify(n: number): ProviderId {
	const id = Array.from({ length: 22 }, (_, i) => ALPHABET[(n * 7 + i * 13) % ALPHABET.length])
	return { service: "spotify", id: id.join("") }
}

const appleMusic = (n: number): ProviderId => ({
	service: "apple_music",
	id: String(1438556800 + n),
})
const isrcFor = (n: number) => `GBARL93${String(n).padStart(5, "0")}`
const videoFor = (n: number) => `uzhfjUSF${String(n).padStart(3, "0")}`

const json = (body: unknown, init: ResponseInit = {}) =>
	new Response(JSON.stringify(body), { status: 200, ...init })

function stubUpstream(handler: Upstream) {
	const calls: number[] = []
	const spy = vi.fn(async (_url: string, init: RequestInit) => {
		calls.push(performance.now())
		const signal = init.signal as AbortSignal
		return handler(JSON.parse(init.body as string) as ProviderId[], signal)
	})
	vi.stubGlobal("fetch", spy)
	return { spy, calls }
}

const hang: Upstream = (_body, signal) =>
	new Promise((_, reject) => {
		signal.addEventListener("abort", () => reject(signal.reason))
	})

async function timed<T>(run: () => Promise<T>) {
	const start = performance.now()
	const value = await run()
	return { value, ms: performance.now() - start }
}

function concurrently<T>(count: number, run: (i: number) => Promise<T>) {
	return Promise.all(Array.from({ length: count }, (_, i) => timed(() => run(i))))
}

const maxMs = (runs: { ms: number }[]) => Math.max(...runs.map((r) => r.ms))

describe("resolveProviderIsrc under a BiniLink outage", () => {
	it("bounds every request by the timeout and stops fetching once the first one fails", async () => {
		const { spy } = stubUpstream(hang)
		const { env } = memoryEnv()

		const first = await concurrently(500, (i) => lookup.resolveProviderIsrc(env, [spotify(i)]))
		expect(maxMs(first)).toBeLessThan(timeoutMs * 2)
		expect(first.every((r) => r.value.kind === "pending")).toBe(true)
		expect(spy).toHaveBeenCalledTimes(500)

		const second = await concurrently(500, (i) => lookup.resolveProviderIsrc(env, [spotify(i)]))
		expect(maxMs(second)).toBeLessThan(50)
		expect(spy).toHaveBeenCalledTimes(500)
		expect(second[0].value).toMatchObject({ kind: "pending", retryAfterSec: pauseSec })
	})

	it("starts no fetch after the first failure while requests keep arriving", async () => {
		let firstFailureAt = Number.POSITIVE_INFINITY
		const { calls } = stubUpstream((body, signal) =>
			hang(body, signal).catch((err: unknown) => {
				firstFailureAt = Math.min(firstFailureAt, performance.now())
				throw err
			})
		)
		const { env } = memoryEnv()

		const runs: Promise<{ ms: number }>[] = []
		for (let i = 0; i < 400; i++) {
			runs.push(timed(() => lookup.resolveProviderIsrc(env, [spotify(i)])))
			await new Promise((resolve) => setTimeout(resolve, 5))
		}
		const results = await Promise.all(runs)

		expect(maxMs(results)).toBeLessThan(timeoutMs * 2)
		expect(calls.length).toBeLessThan(400)
		expect(calls.every((at) => at <= firstFailureAt)).toBe(true)
	})

	it("lets one probe through once the pause expires and answers the rest at once", async () => {
		vi.useFakeTimers({ toFake: ["Date"] })
		const { spy } = stubUpstream(hang)
		const { env } = memoryEnv()

		await lookup.resolveProviderIsrc(env, [spotify(0)])
		expect(spy).toHaveBeenCalledTimes(1)

		vi.setSystemTime(Date.now() + (pauseSec + 1) * 1000)
		const wave = await concurrently(300, (i) => lookup.resolveProviderIsrc(env, [spotify(i)]))

		expect(maxMs(wave)).toBeLessThan(timeoutMs * 2)
		expect(wave.filter((r) => r.ms > timeoutMs / 2)).toHaveLength(1)
		expect(spy).toHaveBeenCalledTimes(2)
	})

	it("regression: keeps the longest pause when a later failure would shorten it", async () => {
		let n = 0
		stubUpstream(async () => {
			n++
			if (n === 1) return json({}, { status: 429, headers: { "retry-after": String(maxPauseSec) } })
			await new Promise((resolve) => setTimeout(resolve, 10))
			throw new TypeError("fetch failed")
		})
		const { env } = memoryEnv()

		await concurrently(200, (i) => lookup.resolveProviderIsrc(env, [spotify(i)]))
		const after = await lookup.resolveProviderIsrc(env, [spotify(999)])

		expect(after).toMatchObject({ kind: "pending", retryAfterSec: maxPauseSec })
	})
})

describe("resolveProviderIsrc under a BiniLink rate limit", () => {
	it.each([429, 503])("makes no fetch until Retry-After passes after a %i", async (status) => {
		vi.useFakeTimers({ toFake: ["Date"] })
		const { spy } = stubUpstream(async (body) =>
			spy.mock.calls.length === 1
				? json({}, { status, headers: { "retry-after": "120" } })
				: json({ results: [], not_found: body, no_isrc: [], pending: [] })
		)
		const { env } = memoryEnv()

		await lookup.resolveProviderIsrc(env, [spotify(0)])
		const paused = await concurrently(1000, (i) => lookup.resolveProviderIsrc(env, [spotify(i)]))
		expect(spy).toHaveBeenCalledTimes(1)
		expect(paused[0].value).toMatchObject({ kind: "pending", retryAfterSec: 120 })

		vi.setSystemTime(Date.now() + 119_000)
		await concurrently(1000, (i) => lookup.resolveProviderIsrc(env, [spotify(i)]))
		expect(spy).toHaveBeenCalledTimes(1)

		vi.setSystemTime(Date.now() + 2000)
		expect((await lookup.resolveProviderIsrc(env, [spotify(1)])).kind).toBe("missing")
		expect(spy).toHaveBeenCalledTimes(2)
	})

	it("caps Retry-After at maxPauseSec", async () => {
		vi.useFakeTimers({ toFake: ["Date"] })
		const { spy } = stubUpstream(async (body) =>
			spy.mock.calls.length === 1
				? json({}, { status: 429, headers: { "retry-after": "86400" } })
				: json({ results: [], not_found: body, no_isrc: [], pending: [] })
		)
		const { env } = memoryEnv()

		await lookup.resolveProviderIsrc(env, [spotify(0)])
		expect(await lookup.resolveProviderIsrc(env, [spotify(1)])).toMatchObject({
			kind: "pending",
			retryAfterSec: maxPauseSec,
		})

		vi.setSystemTime(Date.now() + (maxPauseSec - 1) * 1000)
		await lookup.resolveProviderIsrc(env, [spotify(1)])
		expect(spy).toHaveBeenCalledTimes(1)

		vi.setSystemTime(Date.now() + 2000)
		await lookup.resolveProviderIsrc(env, [spotify(1)])
		expect(spy).toHaveBeenCalledTimes(2)
	})
})

describe("resolveProviderIsrc with a healthy BiniLink", () => {
	it("serves a second wave of hot ids entirely from cache", async () => {
		const found = Array.from({ length: 15 }, (_, i) => spotify(i))
		const absent = Array.from({ length: 5 }, (_, i) => spotify(100 + i))
		const ids = [...found, ...absent]
		const { spy } = stubUpstream(async (body) => {
			await new Promise((resolve) => setTimeout(resolve, 5))
			const index = (id: ProviderId) => found.findIndex((f) => f.id === id.id)
			return json({
				results: body
					.filter((id) => index(id) >= 0)
					.map((id) => ({ ...id, isrc: isrcFor(index(id)), youtube: videoFor(index(id)) })),
				not_found: body.filter((id) => index(id) < 0),
				no_isrc: [],
				pending: [],
			})
		})
		const { env } = memoryEnv()

		const first = await concurrently(1000, (i) => lookup.resolveProviderIsrc(env, [ids[i % 20]]))
		const firstWaveFetches = spy.mock.calls.length
		expect(firstWaveFetches).toBe(1000)

		const second = await concurrently(1000, (i) => lookup.resolveProviderIsrc(env, [ids[i % 20]]))
		expect(spy).toHaveBeenCalledTimes(firstWaveFetches)
		const outcome = ({ value }: { value: { kind: string } }) =>
			value.kind === "isrc" && "isrc" in value ? value.isrc : value.kind
		expect(second.map(outcome)).toEqual(first.map(outcome))
		expect(second[0].value).toMatchObject({ kind: "isrc", isrc: isrcFor(0) })
		expect(second[15].value).toMatchObject({ kind: "missing" })
	})
})

describe("resolveProviderIsrc with mixed pending and results", () => {
	it("returns a result over a pending id and never caches the pending one", async () => {
		const pending = spotify(1)
		const resolved = appleMusic(1)
		const { spy } = stubUpstream(async () =>
			json({
				results: [{ ...resolved, isrc: isrcFor(1), youtube: videoFor(1) }],
				not_found: [],
				no_isrc: [],
				pending: [pending, resolved],
			})
		)
		const { cache, env } = memoryEnv()

		const wave = await concurrently(300, () => lookup.resolveProviderIsrc(env, [pending, resolved]))

		expect(wave.every((r) => r.value.kind === "isrc" && r.value.isrc === isrcFor(1))).toBe(true)
		expect(cache.store.has(`binilink:${pending.service}:${pending.id}`)).toBe(false)
		expect(cache.store.get(`binilink:${resolved.service}:${resolved.id}`)).toBe(isrcFor(1))

		const calls = spy.mock.calls.length
		await lookup.resolveProviderIsrc(env, [pending, resolved])
		expect(spy).toHaveBeenCalledTimes(calls + 1)
		expect(JSON.parse(spy.mock.calls[calls][1].body as string)).toEqual([pending])
	})

	it("answers pending for an all-pending batch and asks again next time", async () => {
		const ids = [spotify(2), appleMusic(2)]
		const { spy } = stubUpstream(async (body) =>
			json({ results: [], not_found: [], no_isrc: [], pending: body })
		)
		const { cache, env } = memoryEnv()

		const wave = await concurrently(300, () => lookup.resolveProviderIsrc(env, ids))

		expect(wave.every((r) => r.value.kind === "pending")).toBe(true)
		expect(wave[0].value).toMatchObject({ kind: "pending", retryAfterSec: pendingRetryAfterSec })
		expect([...cache.store.keys()].filter((k) => k.startsWith("binilink:"))).toEqual([])
		expect(spy).toHaveBeenCalledTimes(300)
	})
})
