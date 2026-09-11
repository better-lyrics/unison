import { describe, expect, it } from "vitest"
import {
	driftTtml,
	formatTtmlTime,
	listSections,
	lowercaseTtmlText,
	parseTtmlTime,
	pickSectionWindow,
	shiftTtml,
	trimTtmlToWindow,
} from "./ttml-timing"

const FIXTURE =
	`<tt xmlns="http://www.w3.org/ns/ttml" itunes:timing="Word"><body dur="4:37.610">` +
	`<div begin="54.836" end="1:01.483" itunes:songPart="Intro">` +
	`<p begin="54.836" end="57.932"><span begin="54.836" end="55.070">Ooh</span></p></div>` +
	`<div begin="1:05.000" end="1:20.000" itunes:songPart="Chorus">` +
	`<p begin="1:05.000" end="1:08.000"><span begin="1:05.000" end="1:06.000">Para</span>` +
	`<span begin="1:06.000" end="1:08.000">dise</span></p></div></body></tt>`

describe("parseTtmlTime", () => {
	it("parses seconds, minutes, and hours forms", () => {
		expect(parseTtmlTime("54.836")).toBeCloseTo(54.836, 3)
		expect(parseTtmlTime("1:01.483")).toBeCloseTo(61.483, 3)
		expect(parseTtmlTime("1:02:03.500")).toBeCloseTo(3723.5, 3)
	})

	describe("edge cases", () => {
		it("is NaN for non-numeric input", () => {
			expect(Number.isNaN(parseTtmlTime("abc"))).toBe(true)
		})
		it("parses a bare zero", () => {
			expect(parseTtmlTime("0")).toBe(0)
		})
	})
})

describe("formatTtmlTime", () => {
	it("uses SS.mmm under a minute and M:SS.mmm under an hour", () => {
		expect(formatTtmlTime(54.836)).toBe("54.836")
		expect(formatTtmlTime(61.483)).toBe("1:01.483")
	})
	it("zero-pads minutes and seconds past an hour", () => {
		expect(formatTtmlTime(3723.5)).toBe("1:02:03.500")
	})

	describe("invariants", () => {
		it("round-trips parse -> format for representative times", () => {
			for (const v of ["0.000", "9.500", "54.836", "1:01.483", "1:02:03.500"]) {
				expect(formatTtmlTime(parseTtmlTime(v))).toBe(v)
			}
		})
		it("never emits a negative time", () => {
			expect(formatTtmlTime(-5)).toBe("0.000")
		})
	})
})

describe("shiftTtml", () => {
	it("shifts every begin and end by the delta but leaves dur", () => {
		const out = shiftTtml(FIXTURE, 0.25)
		expect(out).toContain('begin="55.086"')
		expect(out).toContain('dur="4:37.610"')
	})

	it("is a no-op for a zero delta", () => {
		expect(shiftTtml(FIXTURE, 0)).toBe(FIXTURE)
	})

	it("clamps below zero to zero rather than going negative", () => {
		expect(shiftTtml('<p begin="0.100" end="1.000"/>', -0.5)).toBe('<p begin="0.000" end="0.500"/>')
	})
})

describe("driftTtml", () => {
	it("leaves times before the window and ramps within it", () => {
		const out = driftTtml(FIXTURE, 65, 80, 1)
		// 54.836 is before the window -> unchanged
		expect(out).toContain('begin="54.836"')
		// 68 (1:08.000) is 3s into a 15s window -> +0.2s -> 68.2
		expect(out).toContain('end="1:08.200"')
	})

	it("is a no-op when the window is empty", () => {
		expect(driftTtml(FIXTURE, 70, 70, 1)).toBe(FIXTURE)
	})
})

describe("lowercaseTtmlText", () => {
	it("lowercases text nodes but leaves tags, ids, and times alone", () => {
		const out = lowercaseTtmlText(FIXTURE)
		expect(out).toContain(">para<")
		expect(out).toContain(">dise<")
		expect(out).not.toContain(">Para<")
		// timing attributes and the itunes:timing marker survive untouched
		expect(out).toContain('begin="1:05.000"')
		expect(out).toContain('itunes:timing="Word"')
	})

	it("is idempotent on already-lowercase text", () => {
		const once = lowercaseTtmlText(FIXTURE)
		expect(lowercaseTtmlText(once)).toBe(once)
	})
})

describe("trimTtmlToWindow", () => {
	it("keeps only lines inside the window and drops the emptied div", () => {
		const out = trimTtmlToWindow(FIXTURE, 65, 80)
		// the chorus line (1:05-1:08) is kept
		expect(out).toContain("Para")
		expect(out).toContain("dise")
		// the intro line (54.836) and its whole div are gone
		expect(out).not.toContain("Ooh")
		expect(out).not.toContain("Intro")
	})

	it("keeps the head and body structure around the trimmed lines", () => {
		const out = trimTtmlToWindow(FIXTURE, 65, 80)
		expect(out.startsWith("<tt")).toBe(true)
		expect(out).toContain('dur="4:37.610"')
		expect(out.trimEnd().endsWith("</tt>")).toBe(true)
	})

	it("keeps a line that overlaps the window edge", () => {
		// chorus p spans 65-68; a window ending at 66 still overlaps it
		const out = trimTtmlToWindow(FIXTURE, 60, 66)
		expect(out).toContain("Para")
	})

	describe("edge cases", () => {
		it("returns a lineless body when nothing overlaps", () => {
			const out = trimTtmlToWindow(FIXTURE, 200, 210)
			expect(out).not.toContain("<p")
			expect(out).toContain("</body>")
		})

		it("leaves TTML with no divs untouched", () => {
			const bare = "<tt><body></body></tt>"
			expect(trimTtmlToWindow(bare, 0, 10)).toBe(bare)
		})
	})
})

describe("listSections", () => {
	it("reads each div's part and time bounds", () => {
		const sections = listSections(FIXTURE)
		expect(sections).toHaveLength(2)
		expect(sections[0]).toEqual({ part: "Intro", start: 54.836, end: 61.483 })
		expect(sections[1].part).toBe("Chorus")
	})
})

describe("pickSectionWindow", () => {
	it("prefers the chorus and caps the window length", () => {
		const w = pickSectionWindow(FIXTURE, { prefer: ["Chorus"], maxSec: 10 })
		expect(w).toEqual({ start: 65, end: 75 })
	})

	it("falls back past the intro when no preferred part exists", () => {
		const w = pickSectionWindow(FIXTURE, { prefer: ["Bridge"] })
		expect(w?.start).toBe(65)
	})

	describe("edge cases", () => {
		it("returns null when there are no timed sections", () => {
			expect(pickSectionWindow("<tt><body></body></tt>")).toBeNull()
		})
	})
})
