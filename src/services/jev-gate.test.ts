import { config } from "@/config"
import { AMAZING_GRACE_SPANISH, readRevisionFixture, withTranslation } from "@/test/lyric-fixtures"
import { type LyricLine, extractComparableLines } from "@/utils/extract-text"
import { renderLinesForDiff } from "@/utils/lyric-diff"
import { describe, expect, it } from "vitest"
import {
	type JevGate,
	createTypesafeJevGate,
	disabledJevGate,
	jevLyricContext,
	runJevStep,
} from "./jev-gate"

const LRC = readRevisionFixture("amazing-grace.lrc")
const SPANISH_TTML = withTranslation(
	readRevisionFixture("amazing-grace.ttml"),
	"es",
	AMAZING_GRACE_SPANISH
)
const lrcLines = () => extractComparableLines(LRC, "lrc")
const ttmlLines = () => extractComparableLines(SPANISH_TTML, "ttml")

function edit(lines: LyricLine[], index: number, text: string): LyricLine[] {
	return lines.map((line, i) => (i === index ? { ...line, text } : line))
}

function longSong(verses: number): LyricLine[] {
	return Array.from({ length: verses }, (_, v) =>
		lrcLines().map((line) => ({
			...line,
			startMs: line.startMs === null ? null : line.startMs + v * 120_000,
			text: `${line.text} (verse ${v + 1})`,
		}))
	).flat()
}

const input = {
	lyricsId: 7,
	song: "Amazing Grace",
	artist: "Traditional",
	diff: "-[00:12.00] Amazing grace! How sweet the sound\n+[00:12.00] Amazing grace! How soft the sound",
	lyrics: renderLinesForDiff(lrcLines()),
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
		state: { song: string; artist: string; diff: string; lyrics: string; legend: string }
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

	it("sends the full lyrics as state and explains every field in the legend", async () => {
		const { requests, fetchImpl } = fakeTypesafe(answering([0, 0, 0, 0]))
		await createTypesafeJevGate({ apiKey: "k", fetch: fetchImpl }).check(input)
		const { state } = requests[0].body
		expect(state.lyrics).toBe(input.lyrics)
		expect(state.lyrics).toContain("Amazing grace! How sweet the sound")
		for (const field of ["`lyrics`", "`diff`", "[translation es L3]"]) {
			expect(state.legend).toContain(field)
		}
	})

	it("judges offensive insertions by fit with the song, not by explicitness", async () => {
		const { requests, fetchImpl } = fakeTypesafe(answering([0, 0, 0, 0]))
		await createTypesafeJevGate({ apiKey: "k", fetch: fetchImpl }).check(input)
		const question = requests[0].body.questions.offensive_insertion
		const text = JSON.stringify(question)
		expect(String(question.instructions)).toContain("`lyrics`")
		expect(String(question.instructions)).toMatch(/does not fit/)
		expect(text).toMatch(/tone, subject/)
		expect(text).toMatch(/[Ee]xplicit or profane language consistent with the existing/)
		for (const mask of ["asterisks", "dashes", "[bleep]", "f***", "sh*t"]) {
			expect(text).toContain(mask)
		}
		expect(text).toMatch(/masking a full word/)
		expect(text).toMatch(/real people or groups/)
	})

	it("judges every signal against the full lyrics", async () => {
		const { requests, fetchImpl } = fakeTypesafe(answering([0, 0, 0, 0]))
		await createTypesafeJevGate({ apiKey: "k", fetch: fetchImpl }).check(input)
		for (const question of Object.values(requests[0].body.questions)) {
			expect(String(question.instructions)).toContain("`lyrics`")
		}
	})

	describe("regressions", () => {
		it("regression: still sends the diff, song, and artist beside the lyrics", async () => {
			const { requests, fetchImpl } = fakeTypesafe(answering([0, 0, 0, 0]))
			await createTypesafeJevGate({ apiKey: "k", fetch: fetchImpl }).check(input)
			expect(requests[0].body.state).toMatchObject({
				song: input.song,
				artist: input.artist,
				diff: input.diff,
			})
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

describe("jevLyricContext", () => {
	it("returns the whole lyric, body then labelled head, when it fits", () => {
		const live = ttmlLines()
		const context = jevLyricContext(live, edit(live, 2, "Changed"))
		expect(context).toBe(renderLinesForDiff(live))
		expect(context).toContain("[translation es L3] ")
		expect(context.indexOf("[translation es")).toBeGreaterThan(
			context.indexOf("Amazing grace! How sweet the sound")
		)
	})

	it("shows the current text of a changed line, not the edited text", () => {
		const live = lrcLines()
		const context = jevLyricContext(live, edit(live, 3, "Something else entirely"))
		expect(context).toContain(live[3].text)
		expect(context).not.toContain("Something else entirely")
	})

	it("trims a long lyric around the changed region and marks both cuts", () => {
		const live = longSong(20)
		const changed = Math.floor(live.length / 2)
		const context = jevLyricContext(live, edit(live, changed, "x"), 2000)
		expect(context.length).toBeLessThanOrEqual(2000)
		expect(context).toContain(renderLinesForDiff([live[changed]]))
		expect(context).toContain(renderLinesForDiff(live.slice(changed - 5, changed + 6)))
		expect(context.startsWith("[... earlier lines omitted ...]\n")).toBe(true)
		expect(context.endsWith("[... later lines omitted ...]\n")).toBe(true)
	})

	it("defaults to the configured cap", () => {
		const live = longSong(200)
		expect(renderLinesForDiff(live).length).toBeGreaterThan(config.revisions.jevLyricContextChars)
		const context = jevLyricContext(live, edit(live, 10, "x"))
		expect(context.length).toBeLessThanOrEqual(config.revisions.jevLyricContextChars)
		expect(context.length).toBeGreaterThan(config.revisions.jevLyricContextChars * 0.9)
	})

	describe("edge cases", () => {
		it("keeps the start of the lyric uncut when the change is on the first line", () => {
			const live = longSong(20)
			const context = jevLyricContext(live, edit(live, 0, "x"), 2000)
			expect(context.startsWith(renderLinesForDiff(live.slice(0, 3)))).toBe(true)
			expect(context.endsWith("[... later lines omitted ...]\n")).toBe(true)
		})

		it("keeps the end of the lyric uncut when lines are appended", () => {
			const live = longSong(20)
			const context = jevLyricContext(live, [...live, { text: "Encore", startMs: null }], 2000)
			expect(context.endsWith(renderLinesForDiff(live.slice(-3)))).toBe(true)
			expect(context.startsWith("[... earlier lines omitted ...]\n")).toBe(true)
		})

		it("centres on a changed head line", () => {
			const live = [...longSong(20), ...ttmlLines().filter((line) => line.head)]
			const headIndex = live.findIndex((line) => line.head?.line === 3)
			const context = jevLyricContext(live, edit(live, headIndex, "Otra cosa"), 2000)
			expect(context).toContain("[translation es L3] ")
			expect(context.length).toBeLessThanOrEqual(2000)
		})

		it("starts at the first changed line when the changed region alone exceeds the cap", () => {
			const live = longSong(20)
			const edited = live.map((line) => ({ ...line, text: `${line.text}!` }))
			const context = jevLyricContext(live, edited, 2000)
			expect(context.startsWith(renderLinesForDiff(live.slice(0, 3)))).toBe(true)
			expect(context.length).toBeLessThanOrEqual(2000)
		})

		it("returns an empty context for an empty lyric", () => {
			expect(jevLyricContext([], [{ text: "New", startMs: null }])).toBe("")
		})

		it("keeps unicode lines intact", () => {
			const live = [{ text: "愛してる 🎵", startMs: 1000 }, ...lrcLines()]
			expect(jevLyricContext(live, edit(live, 1, "x"))).toContain("愛してる 🎵")
		})
	})

	describe("invariants", () => {
		it("never cuts a line in half", () => {
			const live = longSong(20)
			const rendered = new Set(live.map((line) => renderLinesForDiff([line])))
			const context = jevLyricContext(live, edit(live, 40, "x"), 1500)
			for (const row of context.split("\n").slice(0, -1)) {
				if (row.startsWith("[... ")) continue
				expect(rendered.has(`${row}\n`)).toBe(true)
			}
		})

		it("keeps lines in their original order", () => {
			const live = longSong(20)
			const context = jevLyricContext(live, edit(live, 40, "x"), 1500)
			const kept = context.split("\n").filter((row) => row && !row.startsWith("[... "))
			const positions = kept.map((row) =>
				live.findIndex((line) => renderLinesForDiff([line]) === `${row}\n`)
			)
			expect(positions).toEqual([...positions].sort((a, b) => a - b))
			expect(positions.at(-1)! - positions[0]).toBe(positions.length - 1)
		})

		it("does not mutate its inputs", () => {
			const live = lrcLines()
			const edited = edit(live, 1, "x")
			const snapshot = JSON.stringify([live, edited])
			jevLyricContext(live, edited, 200)
			expect(JSON.stringify([live, edited])).toBe(snapshot)
		})
	})
})
