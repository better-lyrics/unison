import { afterEach, describe, expect, it, vi } from "vitest"
import { readTranslationProxyEnabled } from "./env"

afterEach(() => {
	vi.unstubAllEnvs()
})

describe("readTranslationProxyEnabled", () => {
	it("defaults to enabled when TRANSLATION_PROXY_DISABLED is unset", () => {
		vi.stubEnv("TRANSLATION_PROXY_DISABLED", "")
		expect(readTranslationProxyEnabled()).toBe(true)
	})

	it("disables the proxy for each recognized truthy value", () => {
		for (const raw of ["true", "1", "yes", "TRUE", " Yes "]) {
			vi.stubEnv("TRANSLATION_PROXY_DISABLED", raw)
			expect(readTranslationProxyEnabled()).toBe(false)
		}
	})

	it("stays enabled for falsy or unrecognized values", () => {
		for (const raw of ["false", "0", "no", "off", "maybe"]) {
			vi.stubEnv("TRANSLATION_PROXY_DISABLED", raw)
			expect(readTranslationProxyEnabled()).toBe(true)
		}
	})
})
