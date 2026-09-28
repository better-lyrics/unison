import { Logger } from "@/infra/logger"
import { disabledJevGate } from "@/services/jev-gate"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
	readJevGate,
	readRecordingMatchEnabled,
	readTranslationProxyEnabled,
	readTypesafeClient,
} from "./env"

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

describe("readJevGate", () => {
	it("uses the disabled gate when TYPESAFE_API_KEY is unset", () => {
		vi.stubEnv("TYPESAFE_API_KEY", "")
		expect(readJevGate()).toBe(disabledJevGate)
	})

	it("uses the disabled gate for a whitespace-only key", () => {
		vi.stubEnv("TYPESAFE_API_KEY", "   ")
		expect(readJevGate()).toBe(disabledJevGate)
	})

	it("uses the TypeSafe gate when a key is set", () => {
		vi.stubEnv("TYPESAFE_API_KEY", "ts-key")
		expect(readJevGate()).not.toBe(disabledJevGate)
	})
})

describe("readTypesafeClient", () => {
	it("disables TypeSafe when TYPESAFE_API_KEY is unset", () => {
		vi.stubEnv("TYPESAFE_API_KEY", "")
		expect(readTypesafeClient()).toBeNull()
	})

	it("disables TypeSafe for a whitespace-only key", () => {
		vi.stubEnv("TYPESAFE_API_KEY", "   ")
		expect(readTypesafeClient()).toBeNull()
	})

	it("returns a client when a key is set", () => {
		vi.stubEnv("TYPESAFE_API_KEY", "ts-key")
		expect(readTypesafeClient()).toEqual({ ask: expect.any(Function) })
	})
})

describe("readRecordingMatchEnabled", () => {
	it("defaults to enabled when RECORDING_MATCH_ENABLED is unset", () => {
		vi.stubEnv("RECORDING_MATCH_ENABLED", "")
		expect(readRecordingMatchEnabled()).toBe(true)
	})

	it("disables matching for each recognized falsy value", () => {
		for (const raw of ["false", "0", "no", "FALSE", " No "]) {
			vi.stubEnv("RECORDING_MATCH_ENABLED", raw)
			expect(readRecordingMatchEnabled()).toBe(false)
		}
	})

	it("stays enabled for truthy values", () => {
		for (const raw of ["true", "1", "yes", " TRUE "]) {
			vi.stubEnv("RECORDING_MATCH_ENABLED", raw)
			expect(readRecordingMatchEnabled()).toBe(true)
		}
	})

	it("turns matching off and warns for an unrecognized value, so a kill switch never fails open", () => {
		const warn = vi.spyOn(Logger.prototype, "warn")
		vi.stubEnv("RECORDING_MATCH_ENABLED", "off-ish")
		expect(readRecordingMatchEnabled()).toBe(false)
		expect(warn).toHaveBeenCalledWith(
			"RECORDING_MATCH_ENABLED is set but did not normalize to true or false",
			{ raw: "off-ish" }
		)
		warn.mockRestore()
	})

	it("is independent of the TypeSafe key, so the revision gate keeps working", () => {
		vi.stubEnv("RECORDING_MATCH_ENABLED", "false")
		vi.stubEnv("TYPESAFE_API_KEY", "ts-key")
		expect(readRecordingMatchEnabled()).toBe(false)
		expect(readJevGate()).not.toBe(disabledJevGate)
		expect(readTypesafeClient()).not.toBeNull()
	})
})
