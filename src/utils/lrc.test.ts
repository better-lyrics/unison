import { describe, expect, it } from "vitest"
import { isLrcFormat, lrcToTtml, parseLrc } from "./lrc"

describe("parseLrc", () => {
	it("parses basic LRC format", () => {
		const lrc = `[00:15.00]First line
[00:20.00]Second line
[00:25.00]Third line`

		const result = parseLrc(lrc)

		expect(result).toHaveLength(3)
		expect(result[0]).toEqual({ timeMs: 15000, text: "First line" })
		expect(result[1]).toEqual({ timeMs: 20000, text: "Second line" })
		expect(result[2]).toEqual({ timeMs: 25000, text: "Third line" })
	})

	it("parses LRC with milliseconds (3 digits)", () => {
		const lrc = "[00:15.123]Line with ms"
		const result = parseLrc(lrc)

		expect(result[0].timeMs).toBe(15123)
	})

	it("parses LRC with centiseconds (2 digits)", () => {
		const lrc = "[00:15.12]Line with cs"
		const result = parseLrc(lrc)

		expect(result[0].timeMs).toBe(15120)
	})

	it("parses LRC with colon separator for ms", () => {
		const lrc = "[00:15:50]Line with colon"
		const result = parseLrc(lrc)

		expect(result[0].timeMs).toBe(15500)
	})

	it("handles minutes correctly", () => {
		const lrc = "[02:30.00]Two minutes thirty"
		const result = parseLrc(lrc)

		expect(result[0].timeMs).toBe(150000)
	})

	it("ignores metadata lines", () => {
		const lrc = `[ar:Artist Name]
[ti:Song Title]
[00:15.00]Actual lyrics`

		const result = parseLrc(lrc)

		expect(result).toHaveLength(1)
		expect(result[0].text).toBe("Actual lyrics")
	})

	it("ignores empty lines", () => {
		const lrc = `[00:15.00]First line
[00:20.00]
[00:25.00]Third line`

		const result = parseLrc(lrc)

		expect(result).toHaveLength(2)
	})

	it("sorts lines by time", () => {
		const lrc = `[00:30.00]Third
[00:10.00]First
[00:20.00]Second`

		const result = parseLrc(lrc)

		expect(result[0].text).toBe("First")
		expect(result[1].text).toBe("Second")
		expect(result[2].text).toBe("Third")
	})

	it("handles empty input", () => {
		expect(parseLrc("")).toHaveLength(0)
	})

	it("handles input with no valid timestamps", () => {
		const lrc = `Just some text
Without timestamps`

		expect(parseLrc(lrc)).toHaveLength(0)
	})

	it("preserves text with special characters", () => {
		const lrc = "[00:15.00]Hello! How are you?"
		const result = parseLrc(lrc)

		expect(result[0].text).toBe("Hello! How are you?")
	})

	it("trims whitespace from text", () => {
		const lrc = "[00:15.00]   Trimmed text   "
		const result = parseLrc(lrc)

		expect(result[0].text).toBe("Trimmed text")
	})
})

describe("lrcToTtml", () => {
	it("converts basic LRC to valid TTML", () => {
		const lrc = "[00:15.00]First line\n[00:20.00]Second line"
		const ttml = lrcToTtml(lrc)

		expect(ttml).toContain('<?xml version="1.0"')
		expect(ttml).toContain("<tt")
		expect(ttml).toContain("</tt>")
		expect(ttml).toContain("<body")
		expect(ttml).toContain("<div")
		expect(ttml).toContain("<p")
	})

	it("includes timing attributes on p elements", () => {
		const lrc = "[00:15.00]Line one\n[00:20.00]Line two"
		const ttml = lrcToTtml(lrc)

		expect(ttml).toContain('begin="00:15.000"')
		expect(ttml).toContain('end="00:20.000"')
	})

	it("calculates end time from next line start", () => {
		const lrc = "[00:10.00]First\n[00:15.00]Second\n[00:20.00]Third"
		const ttml = lrcToTtml(lrc)

		expect(ttml).toMatch(/begin="00:10\.000"[^>]*end="00:15\.000"/)
		expect(ttml).toMatch(/begin="00:15\.000"[^>]*end="00:20\.000"/)
	})

	it("adds 5 seconds to last line end time", () => {
		const lrc = "[00:10.00]Only line"
		const ttml = lrcToTtml(lrc)

		expect(ttml).toContain('end="00:15.000"')
	})

	it("includes language attribute", () => {
		const lrc = "[00:10.00]Test"
		const ttml = lrcToTtml(lrc, "ja")

		expect(ttml).toContain('lang="ja"')
	})

	it("defaults to English language", () => {
		const lrc = "[00:10.00]Test"
		const ttml = lrcToTtml(lrc)

		expect(ttml).toContain('lang="en"')
	})

	it("escapes HTML entities in lyrics", () => {
		const lrc = "[00:10.00]Rock & Roll <3"
		const ttml = lrcToTtml(lrc)

		expect(ttml).toContain("Rock &amp; Roll &lt;3")
		expect(ttml).not.toContain("Rock & Roll <3")
	})

	it("returns empty string for empty LRC", () => {
		expect(lrcToTtml("")).toBe("")
	})

	it("returns empty string for LRC with no valid lines", () => {
		expect(lrcToTtml("[ar:Artist]")).toBe("")
	})

	it("sets timing attribute to Line", () => {
		const lrc = "[00:10.00]Test"
		const ttml = lrcToTtml(lrc)

		expect(ttml).toContain('timing="Line"')
	})

	it("calculates duration from last line", () => {
		const lrc = "[03:25.00]Last line"
		const ttml = lrcToTtml(lrc)

		expect(ttml).toContain('dur="03:30.000"')
	})

	it("formats time correctly for various durations", () => {
		const lrc = "[00:05.500]Five and a half seconds"
		const ttml = lrcToTtml(lrc)

		expect(ttml).toContain('begin="00:05.500"')
	})
})

describe("isLrcFormat", () => {
	it("returns true for valid LRC with period separator", () => {
		expect(isLrcFormat("[00:15.00]Test")).toBe(true)
	})

	it("returns true for valid LRC with colon separator", () => {
		expect(isLrcFormat("[00:15:00]Test")).toBe(true)
	})

	it("returns true for 3-digit milliseconds", () => {
		expect(isLrcFormat("[00:15.123]Test")).toBe(true)
	})

	it("returns true for 2-digit centiseconds", () => {
		expect(isLrcFormat("[00:15.12]Test")).toBe(true)
	})

	it("returns false for plain text", () => {
		expect(isLrcFormat("Just some lyrics")).toBe(false)
	})

	it("returns false for TTML", () => {
		expect(isLrcFormat("<tt><body></body></tt>")).toBe(false)
	})

	it("returns false for empty string", () => {
		expect(isLrcFormat("")).toBe(false)
	})

	it("returns true for LRC with metadata", () => {
		const lrc = `[ar:Artist]
[ti:Title]
[00:15.00]Lyrics`
		expect(isLrcFormat(lrc)).toBe(true)
	})

	it("handles multiline input", () => {
		const lrc = `First line without timestamp
[00:15.00]Second line with timestamp`
		expect(isLrcFormat(lrc)).toBe(true)
	})
})
