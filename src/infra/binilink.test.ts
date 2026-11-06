import { resolveProviderIds } from "@/infra/binilink"
import type { ProviderId } from "@/utils/provider-id"
import { afterEach, describe, expect, it, vi } from "vitest"

const json = (body: unknown, init: ResponseInit = {}) =>
	new Response(JSON.stringify(body), { status: 200, ...init })

const appleTrack: ProviderId = { service: "apple_music", id: "1438556832" }
const resolved = {
	results: [{ ...appleTrack, isrc: "GBARL9300135", youtube: "uzhfjUSF2jg" }],
	not_found: [],
	no_isrc: [],
}

afterEach(() => {
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

describe("resolveProviderIds", () => {
	it("counts a result that is also pending as a match", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ ...resolved, pending: [appleTrack] })))

		const batch = await resolveProviderIds([appleTrack])

		expect(batch?.results).toEqual([
			{ ...appleTrack, isrc: "GBARL9300135", youtube: "uzhfjUSF2jg" },
		])
		expect(batch?.pending).toEqual([])
	})

	it("makes no call after a 503 until its Retry-After passes", async () => {
		vi.useFakeTimers()
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce(
				json({ error: "busy" }, { status: 503, headers: { "retry-after": "5" } })
			)
			.mockResolvedValue(json(resolved))
		vi.stubGlobal("fetch", fetchSpy)

		expect(await resolveProviderIds([appleTrack])).toBeNull()
		expect(await resolveProviderIds([appleTrack])).toBeNull()
		expect(fetchSpy).toHaveBeenCalledTimes(1)

		vi.advanceTimersByTime(5000)
		expect((await resolveProviderIds([appleTrack]))?.results).toHaveLength(1)
		expect(fetchSpy).toHaveBeenCalledTimes(2)
	})
})
