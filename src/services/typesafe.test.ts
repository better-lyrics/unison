import { describe, expect, it } from "vitest"
import { TypesafeHttpError, createTypesafeClient, readNoul, readScore } from "./typesafe"

interface CapturedRequest {
	url: string
	init: RequestInit
	body: { state: unknown; model: string; questions: Record<string, unknown> }
}

function fakeTypesafe(respond: () => Response) {
	const requests: CapturedRequest[] = []
	const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
		requests.push({ url: String(url), init: init ?? {}, body: JSON.parse(String(init?.body)) })
		return respond()
	}
	return { requests, fetchImpl: fetchImpl as typeof fetch }
}

const QUESTIONS = {
	link: {
		type: "score",
		instructions: "How do `lyric_track` and `candidate` relate as recordings?",
		criteria: ["Different", "Related", "Same"],
	},
}

const STATE = {
	lyric_track: { title: "Blinding Lights", artist: "The Weeknd" },
	candidate: {
		title: "Blinding Lights",
		artists: ["The Weeknd"],
		album: "After Hours",
		kind: "audio track",
	},
}

const SCORE_ANSWER = {
	type: "score",
	score: 1.84,
	legend: { "0": "Different", "1": "Related", "2": "Same" },
	probabilities: { "0": 0.02, "1": 0.12, "2": 0.86 },
	confidence: 0.71,
}

describe("createTypesafeClient", () => {
	it("posts the state, model, and questions with bearer auth and returns the answers", async () => {
		const { requests, fetchImpl } = fakeTypesafe(() =>
			Response.json({ model: "jev-1.13.0", answers: { link: SCORE_ANSWER }, usage: {} })
		)
		const answers = await createTypesafeClient({ apiKey: "ts-key", fetch: fetchImpl }).ask({
			state: STATE,
			questions: QUESTIONS,
			timeoutMs: 1500,
		})

		expect(answers).toEqual({ link: SCORE_ANSWER })
		expect(requests).toHaveLength(1)
		const [request] = requests
		expect(request.url).toBe("https://api.typesafe.ai/v1/systemone")
		expect(request.init.method).toBe("POST")
		const headers = new Headers(request.init.headers)
		expect(headers.get("authorization")).toBe("Bearer ts-key")
		expect(headers.get("content-type")).toBe("application/json")
		expect(request.body).toEqual({ state: STATE, model: "jev-latest", questions: QUESTIONS })
	})

	it("gives every request its own timeout signal", async () => {
		const { requests, fetchImpl } = fakeTypesafe(() => Response.json({ answers: {} }))
		const client = createTypesafeClient({ apiKey: "k", fetch: fetchImpl })
		await client.ask({ state: STATE, questions: QUESTIONS, timeoutMs: 1500 })
		await client.ask({ state: STATE, questions: QUESTIONS, timeoutMs: 1500 })
		const [first, second] = requests.map((r) => r.init.signal)
		expect(first).toBeInstanceOf(AbortSignal)
		expect(second).toBeInstanceOf(AbortSignal)
		expect(first).not.toBe(second)
	})

	describe("error paths", () => {
		for (const status of [401, 422, 429, 500, 529]) {
			it(`throws on a ${status} response`, async () => {
				const { fetchImpl } = fakeTypesafe(() => new Response("nope", { status }))
				await expect(
					createTypesafeClient({ apiKey: "k", fetch: fetchImpl }).ask({
						state: STATE,
						questions: QUESTIONS,
						timeoutMs: 1500,
					})
				).rejects.toThrow(String(status))
			})
		}

		it("carries the HTTP status on the error so callers can back off", async () => {
			const { fetchImpl } = fakeTypesafe(() => new Response("busy", { status: 529 }))
			const failure = createTypesafeClient({ apiKey: "k", fetch: fetchImpl }).ask({
				state: STATE,
				questions: QUESTIONS,
				timeoutMs: 1500,
			})
			await expect(failure).rejects.toBeInstanceOf(TypesafeHttpError)
			await expect(failure).rejects.toMatchObject({ status: 529 })
		})

		it("throws when the request times out", async () => {
			const fetchImpl = (async () => {
				throw new DOMException("The operation was aborted due to timeout", "TimeoutError")
			}) as typeof fetch
			await expect(
				createTypesafeClient({ apiKey: "k", fetch: fetchImpl }).ask({
					state: STATE,
					questions: QUESTIONS,
					timeoutMs: 1500,
				})
			).rejects.toThrow(/timeout/)
		})

		it("aborts a request that outlives its timeout", async () => {
			const fetchImpl = ((_url: string, init?: RequestInit) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))
				})) as typeof fetch
			await expect(
				createTypesafeClient({ apiKey: "k", fetch: fetchImpl }).ask({
					state: STATE,
					questions: QUESTIONS,
					timeoutMs: 20,
				})
			).rejects.toThrow(/timeout|aborted/i)
		})

		it("aborts when the caller's signal fires before its own timeout", async () => {
			const seen: AbortSignal[] = []
			const fetchImpl = ((_url: string, init?: RequestInit) =>
				new Promise((_resolve, reject) => {
					if (init?.signal) seen.push(init.signal)
					init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))
				})) as typeof fetch
			const caller = new AbortController()
			const pending = createTypesafeClient({ apiKey: "k", fetch: fetchImpl }).ask({
				state: STATE,
				questions: QUESTIONS,
				timeoutMs: 60_000,
				signal: caller.signal,
			})
			caller.abort(new DOMException("list deadline", "TimeoutError"))
			await expect(pending).rejects.toThrow("list deadline")
			expect(seen[0].aborted).toBe(true)
		})

		it("still times out on its own when the caller's signal never fires", async () => {
			const fetchImpl = ((_url: string, init?: RequestInit) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))
				})) as typeof fetch
			await expect(
				createTypesafeClient({ apiKey: "k", fetch: fetchImpl }).ask({
					state: STATE,
					questions: QUESTIONS,
					timeoutMs: 20,
					signal: new AbortController().signal,
				})
			).rejects.toThrow(/timeout|aborted/i)
		})

		for (const [label, body] of [
			["no answers field", { model: "jev-1.13.0", usage: {} }],
			["answers that are not an object", { answers: "yes" }],
			["null answers", { answers: null }],
		] as const) {
			it(`throws on a response with ${label}`, async () => {
				const { fetchImpl } = fakeTypesafe(() => Response.json(body))
				await expect(
					createTypesafeClient({ apiKey: "k", fetch: fetchImpl }).ask({
						state: STATE,
						questions: QUESTIONS,
						timeoutMs: 1500,
					})
				).rejects.toThrow(/answers/)
			})
		}

		it("throws on a body that is not JSON", async () => {
			const { fetchImpl } = fakeTypesafe(() => new Response("<html>bad gateway</html>"))
			await expect(
				createTypesafeClient({ apiKey: "k", fetch: fetchImpl }).ask({
					state: STATE,
					questions: QUESTIONS,
					timeoutMs: 1500,
				})
			).rejects.toThrow()
		})
	})
})

describe("readNoul", () => {
	it("returns the probability of a noul answer", () => {
		expect(readNoul({ flag: { type: "noul", noul: 0.42 } }, "flag")).toBe(0.42)
	})

	describe("edge cases", () => {
		it("accepts both ends of the range", () => {
			expect(readNoul({ flag: { noul: 0 } }, "flag")).toBe(0)
			expect(readNoul({ flag: { noul: 1 } }, "flag")).toBe(1)
		})
	})

	describe("error paths", () => {
		for (const [label, answers] of [
			["a missing answer", {}],
			["a non-numeric probability", { flag: { noul: "0.4" } }],
			["a negative probability", { flag: { noul: -0.01 } }],
			["a probability above one", { flag: { noul: 1.5 } }],
			["NaN", { flag: { noul: Number.NaN } }],
		] as const) {
			it(`throws on ${label}, naming the question`, () => {
				expect(() => readNoul(answers, "flag")).toThrow(
					"TypeSafe answer for flag is missing or out of range"
				)
			})
		}
	})
})

describe("readScore", () => {
	it("returns the probability-weighted score", () => {
		expect(readScore({ link: SCORE_ANSWER }, "link", 2)).toBe(1.84)
	})

	describe("edge cases", () => {
		it("accepts both ends of the scale", () => {
			expect(readScore({ link: { score: 0 } }, "link", 2)).toBe(0)
			expect(readScore({ link: { score: 2 } }, "link", 2)).toBe(2)
		})
	})

	describe("error paths", () => {
		for (const [label, answers] of [
			["a missing answer", {}],
			["a noul answer in place of a score", { link: { type: "noul", noul: 0.9 } }],
			["a string score", { link: { score: "1.2" } }],
			["a negative score", { link: { score: -0.1 } }],
			["a score above the top level", { link: { score: 2.01 } }],
			["NaN", { link: { score: Number.NaN } }],
			["Infinity", { link: { score: Number.POSITIVE_INFINITY } }],
		] as const) {
			it(`throws on ${label}, naming the question`, () => {
				expect(() => readScore(answers, "link", 2)).toThrow(
					"TypeSafe answer for link is missing or out of range"
				)
			})
		}
	})
})
