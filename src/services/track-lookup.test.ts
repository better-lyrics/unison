import { resolveProviderIsrc } from "@/services/track-lookup"
import type { Env } from "@/types"
import type { ProviderId } from "@/utils/provider-id"
import { afterEach, describe, expect, it, vi } from "vitest"

function memoryEnv(): Env {
	const store = new Map<string, string>()
	const cache = {
		get: async (key: string) => store.get(key) ?? null,
		put: async (key: string, value: string) => {
			store.set(key, value)
		},
	}
	return { CACHE: cache as unknown as Env["CACHE"], BINILINK_LOOKUP_ENABLED: true } as Env
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("resolveProviderIsrc", () => {
	it("never caches a pending id, so the next request asks BiniLink again", async () => {
		const track: ProviderId = { service: "spotify", id: "4uLU6hMCjMI75M1A2tKUQC" }
		const pending = { results: [], not_found: [], no_isrc: [], pending: [track] }
		const fetchSpy = vi.fn().mockImplementation(async () => new Response(JSON.stringify(pending)))
		vi.stubGlobal("fetch", fetchSpy)
		const env = memoryEnv()

		expect((await resolveProviderIsrc(env, [track])).kind).toBe("pending")
		expect((await resolveProviderIsrc(env, [track])).kind).toBe("pending")
		expect(fetchSpy).toHaveBeenCalledTimes(2)
	})
})
