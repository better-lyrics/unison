import { resolveProviderIsrc } from "@/services/track-lookup"
import { makeMemoryCache } from "@/test/integration-harness"
import type { Env } from "@/types"
import type { ProviderId } from "@/utils/provider-id"
import { afterEach, describe, expect, it, vi } from "vitest"

function memoryEnv(): Env {
	return { CACHE: makeMemoryCache() as unknown as Env["CACHE"] } as Env
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
