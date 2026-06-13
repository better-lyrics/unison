import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DETECTOR_VERSION, detectLanguage, detectLanguageBatch } from "./detect-language"

const URL = "http://detect.test"

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	})
}

describe("detectLanguage", () => {
	beforeEach(() => {
		vi.stubEnv("DETECTION_URL", URL)
	})

	afterEach(() => {
		vi.unstubAllEnvs()
		vi.restoreAllMocks()
	})

	it("returns the iso6391 code when confidence is at or above 0.5", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(jsonResponse({ iso6391: "ko", confidence: 0.91 }))
		)

		const result = await detectLanguage("안녕하세요 반갑습니다")

		expect(result).toEqual({ language: "ko", ready: true })
	})

	it("returns null language when confidence is below 0.5 but the service answered", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(jsonResponse({ iso6391: "vi", confidence: 0.34 }))
		)

		const result = await detectLanguage("xin chao")

		expect(result).toEqual({ language: null, ready: true })
	})

	it("returns null language when the service returns iso6391: null", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(jsonResponse({ iso6391: null, confidence: 0.0 }))
		)

		const result = await detectLanguage("...")

		expect(result).toEqual({ language: null, ready: true })
	})

	it("returns ready: false on non-2xx", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "missing text" }, 400)))

		const result = await detectLanguage("hi")

		expect(result).toEqual({ language: null, ready: false })
	})

	it("returns ready: false on network error", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")))

		const result = await detectLanguage("hi")

		expect(result).toEqual({ language: null, ready: false })
	})

	it("returns ready: false on abort/timeout", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "TimeoutError" }))
		)

		const result = await detectLanguage("hi")

		expect(result).toEqual({ language: null, ready: false })
	})

	it("returns ready: false without a fetch call when DETECTION_URL is unset", async () => {
		vi.unstubAllEnvs()
		vi.stubEnv("DETECTION_URL", "")
		const fetchSpy = vi.fn()
		vi.stubGlobal("fetch", fetchSpy)

		const result = await detectLanguage("hi")

		expect(result).toEqual({ language: null, ready: false })
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it("returns ready: true with null language for empty input without calling fetch", async () => {
		const fetchSpy = vi.fn()
		vi.stubGlobal("fetch", fetchSpy)

		expect(await detectLanguage("")).toEqual({ language: null, ready: true })
		expect(await detectLanguage("   \n\t ")).toEqual({ language: null, ready: true })
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it("POSTs text as JSON to /detect", async () => {
		const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ iso6391: "en", confidence: 0.99 }))
		vi.stubGlobal("fetch", fetchSpy)

		await detectLanguage("hello there")

		expect(fetchSpy).toHaveBeenCalledTimes(1)
		const [calledUrl, init] = fetchSpy.mock.calls[0]
		expect(calledUrl).toBe(`${URL}/detect`)
		expect(init.method).toBe("POST")
		expect(init.headers["content-type"]).toBe("application/json")
		expect(JSON.parse(init.body)).toEqual({ text: "hello there" })
		expect(init.signal).toBeInstanceOf(AbortSignal)
	})
})

describe("detectLanguageBatch", () => {
	beforeEach(() => {
		vi.stubEnv("DETECTION_URL", URL)
	})

	afterEach(() => {
		vi.unstubAllEnvs()
		vi.restoreAllMocks()
	})

	it("returns per-item results in input order with threshold applied", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				jsonResponse({
					results: [
						{ iso6391: "ko", confidence: 0.9 },
						{ iso6391: "en", confidence: 0.3 },
						{ iso6391: null, confidence: 0.0 },
					],
				})
			)
		)

		const results = await detectLanguageBatch(["안녕", "hi", ""])

		expect(results).toEqual([
			{ language: "ko", ready: true },
			{ language: null, ready: true },
			{ language: null, ready: true },
		])
	})

	it("returns an empty array for empty input without calling fetch", async () => {
		const fetchSpy = vi.fn()
		vi.stubGlobal("fetch", fetchSpy)

		expect(await detectLanguageBatch([])).toEqual([])
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it("returns ready: false for every item on non-2xx", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "boom" }, 500)))

		const results = await detectLanguageBatch(["a", "b", "c"])

		expect(results).toEqual([
			{ language: null, ready: false },
			{ language: null, ready: false },
			{ language: null, ready: false },
		])
	})

	it("returns ready: false for every item on network error", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")))

		const results = await detectLanguageBatch(["a", "b"])

		expect(results).toEqual([
			{ language: null, ready: false },
			{ language: null, ready: false },
		])
	})

	it("returns ready: false for every item when DETECTION_URL is unset", async () => {
		vi.unstubAllEnvs()
		const fetchSpy = vi.fn()
		vi.stubGlobal("fetch", fetchSpy)

		const results = await detectLanguageBatch(["a", "b"])

		expect(results).toEqual([
			{ language: null, ready: false },
			{ language: null, ready: false },
		])
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it("POSTs texts as JSON to /detect/batch with a 30s timeout signal", async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValue(jsonResponse({ results: [{ iso6391: "en", confidence: 0.99 }] }))
		vi.stubGlobal("fetch", fetchSpy)

		await detectLanguageBatch(["hello"])

		const [calledUrl, init] = fetchSpy.mock.calls[0]
		expect(calledUrl).toBe(`${URL}/detect/batch`)
		expect(init.method).toBe("POST")
		expect(JSON.parse(init.body)).toEqual({ texts: ["hello"] })
		expect(init.signal).toBeInstanceOf(AbortSignal)
	})
})

describe("DETECTOR_VERSION", () => {
	it("is the integer 3", () => {
		expect(DETECTOR_VERSION).toBe(3)
	})
})
