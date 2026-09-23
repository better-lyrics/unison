import { describe, expect, it } from "vitest"
import { type JevGate, createTypesafeJevGate, disabledJevGate, runJevStep } from "./jev-gate"

const input = {
	lyricsId: 7,
	song: "Amazing Grace",
	artist: "Traditional",
	diff: "-[00:12.00] Amazing grace! How sweet the sound\n+[00:12.00] Amazing grace! How soft the sound",
}

describe("runJevStep", () => {
	it("is a no-op when the gate is disabled", async () => {
		expect(await runJevStep(disabledJevGate, input)).toEqual({ flagged: false, probability: null })
	})

	it("passes a verdict through", async () => {
		const flagging: JevGate = { check: async () => ({ flagged: true, probability: 0.82 }) }
		expect(await runJevStep(flagging, input)).toEqual({ flagged: true, probability: 0.82 })
	})

	describe("regressions", () => {
		it("regression: a failing gate is treated as not flagged instead of blocking the edit", async () => {
			const failing: JevGate = {
				check: async () => {
					throw new Error("TypeSafe returned 503")
				},
			}
			expect(await runJevStep(failing, input)).toEqual({ flagged: false, probability: null })
		})
	})
})

interface CapturedRequest {
	url: string
	init: RequestInit
	body: {
		state: { song: string; artist: string; diff: string }
		model: string
		questions: Record<string, { type: string; instructions: unknown; criteria?: unknown }>
	}
}

function fakeTypesafe(respond: (body: CapturedRequest["body"]) => Response) {
	const requests: CapturedRequest[] = []
	const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
		const body = JSON.parse(String(init?.body)) as CapturedRequest["body"]
		requests.push({ url: String(url), init: init ?? {}, body })
		return respond(body)
	}
	return { requests, fetchImpl: fetchImpl as typeof fetch }
}

function answering(probabilities: number[]) {
	return (body: CapturedRequest["body"]) =>
		Response.json({
			model: "jev-1.13.0",
			answers: Object.fromEntries(
				Object.keys(body.questions).map((id, i) => [
					id,
					{ type: "noul", noul: probabilities[i] ?? 0 },
				])
			),
			usage: { input_tokens: 400, output_tokens: 20 },
		})
}

describe("createTypesafeJevGate", () => {
	it("asks every signal in one request with the diff, song, and artist as state", async () => {
		const { requests, fetchImpl } = fakeTypesafe(answering([0.1, 0.1, 0.1, 0.1]))
		await createTypesafeJevGate({ apiKey: "test-key", fetch: fetchImpl }).check(input)

		expect(requests).toHaveLength(1)
		const [request] = requests
		expect(request.url).toBe("https://api.typesafe.ai/v1/systemone")
		expect(request.init.method).toBe("POST")
		expect(new Headers(request.init.headers).get("authorization")).toBe("Bearer test-key")
		expect(request.body.model).toBe("jev-latest")
		expect(request.body.state).toMatchObject({
			song: "Amazing Grace",
			artist: "Traditional",
			diff: input.diff,
		})
		expect(Object.keys(request.body.questions).sort()).toEqual([
			"deliberate_corruption",
			"offensive_insertion",
			"section_removal",
			"unrelated_content",
		])
	})

	it("flags an edit when any signal reaches the threshold and keeps the highest probability", async () => {
		const { fetchImpl } = fakeTypesafe(answering([0.05, 0.91, 0.3, 0.2]))
		expect(await createTypesafeJevGate({ apiKey: "k", fetch: fetchImpl }).check(input)).toEqual({
			flagged: true,
			probability: 0.91,
		})
	})

	it("passes an edit when every signal is under the threshold and still records the highest", async () => {
		const { fetchImpl } = fakeTypesafe(answering([0.05, 0.12, 0.64, 0.2]))
		expect(await createTypesafeJevGate({ apiKey: "k", fetch: fetchImpl }).check(input)).toEqual({
			flagged: false,
			probability: 0.64,
		})
	})

	describe("edge cases", () => {
		it("flags a probability exactly at the threshold", async () => {
			const { fetchImpl } = fakeTypesafe(answering([0.8, 0, 0, 0]))
			const verdict = await createTypesafeJevGate({ apiKey: "k", fetch: fetchImpl }).check(input)
			expect(verdict).toEqual({ flagged: true, probability: 0.8 })
		})

		it("gives the request a timeout signal", async () => {
			const { requests, fetchImpl } = fakeTypesafe(answering([0, 0, 0, 0]))
			await createTypesafeJevGate({ apiKey: "k", fetch: fetchImpl }).check(input)
			expect(requests[0].init.signal).toBeInstanceOf(AbortSignal)
		})
	})

	describe("error paths", () => {
		it("throws on a non-2xx response", async () => {
			const { fetchImpl } = fakeTypesafe(() => new Response("overloaded", { status: 529 }))
			await expect(
				createTypesafeJevGate({ apiKey: "k", fetch: fetchImpl }).check(input)
			).rejects.toThrow(/529/)
		})

		it("throws when an answer is missing", async () => {
			const { fetchImpl } = fakeTypesafe(() =>
				Response.json({ model: "jev-1.13.0", answers: {}, usage: {} })
			)
			await expect(
				createTypesafeJevGate({ apiKey: "k", fetch: fetchImpl }).check(input)
			).rejects.toThrow(/offensive_insertion/)
		})

		it("throws when a probability is out of range", async () => {
			const { fetchImpl } = fakeTypesafe(answering([1.5, 0, 0, 0]))
			await expect(
				createTypesafeJevGate({ apiKey: "k", fetch: fetchImpl }).check(input)
			).rejects.toThrow(/offensive_insertion/)
		})

		it("is treated as not flagged by runJevStep when the call fails", async () => {
			const fetchImpl = (async () => {
				throw new DOMException("The operation was aborted due to timeout", "TimeoutError")
			}) as typeof fetch
			const gate = createTypesafeJevGate({ apiKey: "k", fetch: fetchImpl })
			expect(await runJevStep(gate, input)).toEqual({ flagged: false, probability: null })
		})
	})

	describe("invariants", () => {
		it("asks only yes or no questions, each with both criteria", async () => {
			const { requests, fetchImpl } = fakeTypesafe(answering([0, 0, 0, 0]))
			await createTypesafeJevGate({ apiKey: "k", fetch: fetchImpl }).check(input)
			for (const question of Object.values(requests[0].body.questions)) {
				expect(question.type).toBe("noul")
				expect(question.criteria).toEqual({ true: expect.any(String), false: expect.any(String) })
			}
		})
	})
})
