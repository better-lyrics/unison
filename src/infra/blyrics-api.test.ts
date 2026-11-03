import { notifyLyricsInvalidated } from "@/infra/blyrics-api"
import type { Env } from "@/types"
import { afterEach, describe, expect, it, vi } from "vitest"

const target = { url: "https://lyrics.example/unison/invalidate", secret: "s3cret" }

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("notifyLyricsInvalidated", () => {
	it("does nothing when the Better Lyrics API is not configured", () => {
		const fetchSpy = vi.fn()
		vi.stubGlobal("fetch", fetchSpy)
		notifyLyricsInvalidated({ BLYRICS_API_INVALIDATE: null } as Env, ["a"])
		notifyLyricsInvalidated({ BLYRICS_API_INVALIDATE: target } as Env, [])
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it("posts deduplicated video ids in batches with the bearer secret", () => {
		const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
		vi.stubGlobal("fetch", fetchSpy)
		const ids = Array.from({ length: 501 }, (_, i) => `v${i}`)
		notifyLyricsInvalidated({ BLYRICS_API_INVALIDATE: target } as Env, [...ids, "v0"])

		expect(fetchSpy).toHaveBeenCalledTimes(2)
		const [url, init] = fetchSpy.mock.calls[0]
		expect(url).toBe(target.url)
		expect(init.method).toBe("POST")
		expect(init.headers.authorization).toBe("Bearer s3cret")
		expect(JSON.parse(init.body).videoIds).toHaveLength(500)
		expect(JSON.parse(fetchSpy.mock.calls[1][1].body).videoIds).toEqual(["v500"])
	})

	it("swallows network failures", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")))
		expect(() =>
			notifyLyricsInvalidated({ BLYRICS_API_INVALIDATE: target } as Env, ["a"])
		).not.toThrow()
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
})
