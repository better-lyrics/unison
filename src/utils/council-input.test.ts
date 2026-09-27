import { describe, expect, it } from "vitest"
import { parseCouncilNote } from "./council-input"

describe("parseCouncilNote", () => {
	it("accepts and trims a note", () => {
		expect(parseCouncilNote({ note: "  late chorus  " })).toEqual({ ok: true, note: "late chorus" })
	})

	describe("edge cases", () => {
		it("treats a missing, null or blank note as no note", () => {
			expect(parseCouncilNote({})).toEqual({ ok: true, note: null })
			expect(parseCouncilNote({ note: null })).toEqual({ ok: true, note: null })
			expect(parseCouncilNote({ note: "   \n " })).toEqual({ ok: true, note: null })
		})

		it("accepts exactly the limit and refuses one more character", () => {
			expect(parseCouncilNote({ note: "x".repeat(1000) }).ok).toBe(true)
			expect(parseCouncilNote({ note: "x".repeat(1001) })).toEqual({ ok: false })
		})

		it("counts the limit after trimming", () => {
			expect(parseCouncilNote({ note: ` ${"x".repeat(1000)} ` }).ok).toBe(true)
		})

		it("keeps unicode intact", () => {
			expect(parseCouncilNote({ note: "サビのタイミング 🎵" })).toEqual({
				ok: true,
				note: "サビのタイミング 🎵",
			})
		})
	})

	describe("error paths", () => {
		it("refuses a note that is not text", () => {
			expect(parseCouncilNote({ note: 42 })).toEqual({ ok: false })
			expect(parseCouncilNote({ note: ["late"] })).toEqual({ ok: false })
		})
	})
})
