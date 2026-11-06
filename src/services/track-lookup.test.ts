import { config } from "@/config"
import { resolveProviderIsrc } from "@/services/track-lookup"
import { makeMemoryCache } from "@/test/integration-harness"
import type { Env } from "@/types"
import type { ProviderId } from "@/utils/provider-id"
import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("resolveProviderIsrc", () => {
	it("caches a pending id only until its retry, never as a miss", async () => {
		const track: ProviderId = { service: "spotify", id: "4uLU6hMCjMI75M1A2tKUQC" }
		const pending = { results: [], not_found: [], no_isrc: [], pending: [track] }
		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation(async () => new Response(JSON.stringify(pending)))
		)
		const cache = makeMemoryCache()
		const ttls = new Map<string, number | undefined>()
		const put = cache.put
		cache.put = async (key: string, value: string, opts?: { expirationTtl?: number }) => {
			ttls.set(key, opts?.expirationTtl)
			await put(key, value)
		}
		const env = { CACHE: cache as unknown as Env["CACHE"] } as Env

		expect((await resolveProviderIsrc(env, [track])).kind).toBe("pending")
		expect((await resolveProviderIsrc(env, [track])).kind).toBe("pending")
		expect(ttls.get(`binilink:spotify:${track.id}`)).toBe(config.binilink.pendingRetryAfterSec)
	})
})
