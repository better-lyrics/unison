import type { Env } from "@/types"
import { isBlyricsApiRequest } from "@/utils/blyrics-api-auth"
import { describe, expect, it } from "vitest"

const env = { BLYRICS_API_KEY: "k3y" } as Env

describe("isBlyricsApiRequest", () => {
	it("accepts the configured key", () => {
		expect(isBlyricsApiRequest({ "x-blyrics-api-key": "k3y" }, env)).toBe(true)
	})

	it("rejects a missing or wrong key", () => {
		expect(isBlyricsApiRequest({}, env)).toBe(false)
		expect(isBlyricsApiRequest({ "x-blyrics-api-key": "k3x" }, env)).toBe(false)
		expect(isBlyricsApiRequest({ "x-blyrics-api-key": "longer" }, env)).toBe(false)
	})

	it("rejects everything when no key is configured", () => {
		expect(isBlyricsApiRequest({ "x-blyrics-api-key": "" }, { BLYRICS_API_KEY: null } as Env)).toBe(
			false
		)
	})
})
